const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch {
  GoogleGenAI = null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const ai = process.env.GEMINI_API_KEY && GoogleGenAI
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const laporanStore = [];

const dapurStore = Array.from({ length: 30 }, (_, index) => {
  const number = index + 1;
  const padded = String(number).padStart(2, '0');
  const wilayah = [
    'Sumedang', 'Garut', 'Bandung', 'Tasikmalaya', 'Cimahi',
    'Cirebon', 'Bogor', 'Depok', 'Bekasi', 'Karawang',
  ][index % 10];

  return {
    id: `D-${padded}`,
    username: `dapur${padded}`,
    password: `sppg${padded}`,
    nama: `SPPG Dapur ${padded} ${wilayah}`,
    wilayah,
    targetPorsi: 1500 + (index % 6) * 125,
    batasAnggaran: 13500000 + (index % 6) * 1125000,
    status: 'AKTIF',
  };
});

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const normalized = String(value).replace(/[^\d,-]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
};

function normalizeItems(items = []) {
  return items.map((item, index) => {
    const qty = toNumber(item.qty ?? item.qtyRencana ?? item.qty_rencana);
    const hargaRab = toNumber(item.hargaRab ?? item.harga_rab ?? item.harga_rencana);
    // BUG FIX: hargaRiil seharusnya harga satuan, bukan totalRiil.
    // Fallback totalRiil menggunakan qty * hargaRiil bukan hanya hargaRiil.
    const hargaRiil = toNumber(item.hargaRiil ?? item.harga ?? 0);
    const totalRab = toNumber(item.totalRab) || qty * hargaRab;
    const totalRiil = toNumber(item.totalRiil) || (qty * hargaRiil);
    const sumber = String(item.sumber || item.lokasiBeli || 'KOPERASI').toUpperCase();
    const isGudang = sumber === 'AMBIL_GUDANG' || sumber === 'GUDANG_MANDIRI';
    const selisih = totalRiil - totalRab;
    const deviasiPersen = totalRab > 0 ? (selisih / totalRab) * 100 : 0;

    return {
      id: item.id ?? index + 1,
      namaBarang: item.namaBarang || item.nama || `Item ${index + 1}`,
      qty,
      satuan: item.satuan || '',
      hargaRab,
      totalRab,
      totalRiil,
      sumber,
      fotoNota: item.fotoNota || null,
      catatan: item.catatan || '',
      selisih,
      deviasiPersen,
      // BUG FIX: item dari gudang mandiri tidak perlu foto nota — dikecualikan dari flag foto.
      flagged: deviasiPersen > 10 || selisih > 50000 || (!isGudang && !item.fotoNota),
    };
  });
}

function buildAudit(laporan = laporanStore) {
  const allItems = laporan.flatMap((entry) => entry.items);
  const totalRab = allItems.reduce((sum, item) => sum + item.totalRab, 0);
  const totalRiil = allItems.reduce((sum, item) => sum + item.totalRiil, 0);
  const totalKoperasi = allItems
    .filter((item) => item.sumber.includes('KOPERASI'))
    .reduce((sum, item) => sum + item.totalRiil, 0);
  const totalMarkupPotensial = allItems
    .filter((item) => item.selisih > 0)
    .reduce((sum, item) => sum + item.selisih, 0);
  const itemsFlagged = allItems
    .filter((item) => item.flagged)
    .sort((a, b) => b.deviasiPersen - a.deviasiPersen)
    .slice(0, 25);

  return {
    totalLaporan: laporan.length,
    totalItem: allItems.length,
    totalRab,
    totalRiil,
    totalMarkupPotensial,
    persenKoperasi: totalRiil > 0 ? (totalKoperasi / totalRiil) * 100 : 0,
    itemsFlagged,
    status: totalMarkupPotensial > totalRab * 0.05 ? 'PERLU_INVESTIGASI' : 'NORMAL',
  };
}

function publicDapur(dapur) {
  const { password, ...safeDapur } = dapur;
  const centralUrl = process.env.SPREADSHEET_CENTRAL_URL || '';
  safeDapur.urlApi = centralUrl ? `${centralUrl}?dapur=${dapur.username}` : '';
  return safeDapur;
}

function filterLaporanByDapur(idDapur) {
  if (!idDapur || idDapur === 'ALL') return laporanStore;
  return laporanStore.filter((entry) => entry.idDapur === idDapur);
}

function buildDapurSummary() {
  return dapurStore.map((dapur) => {
    const laporanDapur = filterLaporanByDapur(dapur.id);
    const audit = buildAudit(laporanDapur);
    const latest = laporanDapur[0] || null;

    return {
      ...publicDapur(dapur),
      totalLaporan: laporanDapur.length,
      totalRab: audit.totalRab,
      totalRiil: audit.totalRiil,
      totalMarkupPotensial: audit.totalMarkupPotensial,
      persenKoperasi: audit.persenKoperasi,
      flaggedCount: audit.itemsFlagged.length,
      lastReportAt: latest?.createdAt || null,
      statusAudit: !latest
        ? 'BELUM_LAPOR'
        : audit.status === 'PERLU_INVESTIGASI'
          ? 'PERLU_INVESTIGASI'
          : 'NORMAL',
    };
  });
}

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    mode: ai ? 'ai-enabled' : 'local-audit',
    laporan: laporanStore.length,
    dapur: dapurStore.length,
  });
});

app.get('/api/dapur', (_req, res) => {
  res.json({ success: true, data: dapurStore.map(publicDapur) });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').toLowerCase().trim();
  const password = String(req.body?.password || '');

  const dapur = dapurStore.find(
    (item) => item.username === username && item.password === password,
  );

  if (!dapur) {
    return res.status(401).json({
      success: false,
      message: 'Username atau password salah.',
    });
  }

  res.json({
    success: true,
    message: 'Login berhasil.',
    data: publicDapur(dapur),
  });
});

app.post('/api/laporan', (req, res) => {
  const payload = req.body || {};
  const items = normalizeItems(payload.items || (payload.namaBarang ? [payload] : []));

  if (!payload.idDapur && !payload.dapur) {
    return res.status(400).json({ success: false, message: 'idDapur wajib diisi.' });
  }

  if (!items.length) {
    return res.status(400).json({ success: false, message: 'Minimal satu item laporan wajib dikirim.' });
  }

  const laporan = {
    id: `LAP-${Date.now()}`,
    idDapur: payload.idDapur || payload.dapur,
    namaDapur: payload.namaDapur || payload.dapur || payload.idDapur,
    tanggalInput: formatDateKey(payload.tanggalInput),
    targetPorsi: toNumber(payload.targetPorsi),
    batasAnggaran: toNumber(payload.batasAnggaran),
    fotoMasakan: payload.fotoMasakan || null,
    items,
    createdAt: new Date().toISOString(),
  };

  laporan.totalRab = items.reduce((sum, item) => sum + item.totalRab, 0);
  laporan.totalRiil = items.reduce((sum, item) => sum + item.totalRiil, 0);
  laporan.hppRiil = laporan.targetPorsi > 0 ? laporan.totalRiil / laporan.targetPorsi : 0;
  laporan.hppRab = laporan.targetPorsi > 0
    ? (laporan.batasAnggaran || laporan.totalRab) / laporan.targetPorsi
    : 0;
  laporan.audit = buildAudit([laporan]);

  laporanStore.unshift(laporan);

  // INTEGRASI KLED0: Otomatis sinkronisasi biaya belanja ke Kledo di background
  syncToKledo(laporan);

  res.status(201).json({
    success: true,
    message: 'Laporan diterima dan diaudit.',
    data: laporan,
  });
});

// Helper integrasi API Kledo
async function syncToKledo(laporan) {
  const kledoUrl = process.env.KLEDO_API_URL;
  const kledoToken = process.env.KLEDO_API_TOKEN;
  const kledoAccountId = process.env.KLEDO_EXPENSE_ACCOUNT_ID;

  if (!kledoUrl || !kledoToken || !kledoAccountId) {
    console.log('ℹ️ [Kledo Sync] Dilewati. Lengkapi KLEDO_API_URL, TOKEN, dan ACCOUNT_ID di file .env untuk mengaktifkan.');
    return;
  }

  console.log(`⏳ [Kledo Sync] Mengirim pengeluaran ${laporan.namaDapur} senilai Rp ${laporan.totalRiil.toLocaleString('id-ID')}...`);
  try {
    const payload = {
      trans_date: laporan.tanggalInput,
      amount: laporan.totalRiil,
      account_id: Number(kledoAccountId),
      memo: `Belanja bahan makanan ${laporan.namaDapur} (LAP: ${laporan.id})`,
      // Kita kirimkan file foto nota (jika ada) ke Kledo sebagai attachment
      attachment: laporan.items.find(item => item.fotoNota)?.fotoNota || laporan.fotoMasakan || null
    };

    const response = await fetch(`${kledoUrl}/expenses`, {
      method: 'POST',
      headers: {
        'Authorization': kledoToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.ok && result.success) {
      console.log(`✅ [Kledo Sync] Transaksi berhasil tercatat di Kledo dengan ID: ${result.data?.id}`);
    } else {
      console.warn(`⚠️ [Kledo Sync] Kledo menolak data: ${result.message || response.statusText}`);
    }
  } catch (error) {
    console.error('❌ [Kledo Sync] Gagal menghubungi server Kledo:', error.message);
  }
}

app.get('/api/laporan', (req, res) => {
  res.json({ success: true, data: filterLaporanByDapur(req.query.idDapur) });
});

app.get('/api/audit', (req, res) => {
  res.json({ success: true, data: buildAudit(filterLaporanByDapur(req.query.idDapur)) });
});

app.get('/api/dashboard', (_req, res) => {
  res.json({
    success: true,
    data: {
      audit: buildAudit(),
      dapur: buildDapurSummary(),
      laporan: laporanStore,
    },
  });
});

// =========================================================================
// KOPERASI MARKETPLACE APIS
// =========================================================================

let koperasiKatalog = [
  { id: 'KOP-01', namaBarang: 'Beras Medium', satuan: 'Kg', hargaSatuan: 14000 },
  { id: 'KOP-02', namaBarang: 'Telur Ayam', satuan: 'Kg', hargaSatuan: 26000 },
  { id: 'KOP-03', namaBarang: 'Minyak Goreng Sunco 2L', satuan: 'Pcs', hargaSatuan: 38000 },
  { id: 'KOP-04', namaBarang: 'Bawang Merah Kupas', satuan: 'Kg', hargaSatuan: 45000 },
  { id: 'KOP-05', namaBarang: 'Bawang Putih Kupas', satuan: 'Kg', hargaSatuan: 40000 },
  { id: 'KOP-06', namaBarang: 'Garam Halus 250g', satuan: 'Bks', hargaSatuan: 2500 },
  { id: 'KOP-07', namaBarang: 'Merica Bubuk Ladaku', satuan: 'Pcs', hargaSatuan: 1500 },
  { id: 'KOP-08', namaBarang: 'Saos Tiram Saori', satuan: 'Botol', hargaSatuan: 12000 },
];

const orderStore = [];

app.get('/api/koperasi/katalog', (_req, res) => {
  res.json({ success: true, data: koperasiKatalog });
});

app.post('/api/koperasi/katalog', (req, res) => {
  const { namaBarang, satuan, hargaSatuan } = req.body;
  if (!namaBarang || !satuan || !hargaSatuan) {
    return res.status(400).json({ success: false, message: 'Data produk tidak lengkap.' });
  }

  const newProduct = {
    id: `KOP-${String(koperasiKatalog.length + 1).padStart(2, '0')}-${Date.now().toString().slice(-4)}`,
    namaBarang: String(namaBarang).trim(),
    satuan: String(satuan).trim(),
    hargaSatuan: toNumber(hargaSatuan)
  };

  koperasiKatalog.push(newProduct);
  res.status(201).json({ success: true, message: 'Produk berhasil diunggah.', data: newProduct });
});

app.delete('/api/koperasi/katalog/:id', (req, res) => {
  const { id } = req.params;
  const initialLength = koperasiKatalog.length;
  koperasiKatalog = koperasiKatalog.filter(item => item.id !== id);

  if (koperasiKatalog.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
  }
  res.json({ success: true, message: 'Produk berhasil dihapus.' });
});

app.post('/api/koperasi/order', (req, res) => {
  const { idDapur, namaDapur, items } = req.body;
  if (!idDapur || !items || !items.length) {
    return res.status(400).json({ success: false, message: 'Data pesanan tidak lengkap.' });
  }
  const totalHarga = items.reduce((sum, item) => sum + (item.qty * item.hargaSatuan), 0);
  const order = {
    id: `ORD-${Date.now()}`,
    idDapur,
    namaDapur,
    items: items.map(i => ({
      namaBarang: i.namaBarang,
      qty: toNumber(i.qty),
      satuan: i.satuan,
      hargaSatuan: toNumber(i.hargaSatuan),
      total: toNumber(i.qty) * toNumber(i.hargaSatuan)
    })),
    totalHarga,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  orderStore.unshift(order);
  res.json({ success: true, message: 'Pesanan kulakan berhasil dibuat.', data: order });
});

app.get('/api/koperasi/order', (req, res) => {
  const { idDapur, status } = req.query;
  let filtered = orderStore;
  if (idDapur) {
    filtered = filtered.filter(o => o.idDapur === idDapur);
  }
  if (status) {
    filtered = filtered.filter(o => o.status === status);
  }
  res.json({ success: true, data: filtered });
});

app.post('/api/koperasi/order/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const order = orderStore.find(o => o.id === id);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
  }
  order.status = status;
  res.json({ success: true, message: `Status pesanan diupdate menjadi ${status}.`, data: order });
});

app.post('/api/anggaran/upload-rab', async (req, res) => {
  try {
    const { mime_type, file_base64 } = req.body;

    if (!file_base64) {
      return res.status(400).json({ success: false, message: 'File PDF/Excel tidak ditemukan.' });
    }

    if (!ai) {
      return res.status(503).json({
        success: false,
        message: 'GEMINI_API_KEY belum diatur. Gunakan mode input spreadsheet/offline dahulu.',
      });
    }

    const systemInstruction = `
Extract RAB/SPPG budget rows into valid JSON only.
Do not summarize, group, or skip rows. Preserve item names.
Return:
{
  "tanggal": "string",
  "total_pagu": number,
  "items": [
    {
      "id": number,
      "nama": "string",
      "qty_rencana": number,
      "satuan": "string",
      "harga_rencana": number,
      "tipe": "basah|stok"
    }
  ]
}
`;

    const responseAI = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: systemInstruction },
          { inlineData: { mimeType: mime_type || 'application/pdf', data: file_base64 } },
        ],
      }],
      config: { responseMimeType: 'application/json' },
    });

    let hasilExtract;
    try {
      hasilExtract = JSON.parse(responseAI.text);
    } catch (parseErr) {
      return res.status(500).json({ success: false, message: `Gagal parse response AI: ${parseErr.message}` });
    }
    res.status(200).json({
      success: true,
      message: 'Berhasil dianalisis AI.',
      data_preview: hasilExtract,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: `Gagal memproses file: ${error.message}` });
  }
});

app.use(express.static(__dirname));
app.use('/mobile', express.static(path.join(__dirname, 'sppg-pic-app', 'dist')));
// BUG FIX: wildcard route SPA harus menangkap semua sub-path agar React Router berfungsi
app.get(['/mobile', '/mobile/*'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'sppg-pic-app', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => {
  console.log('=================================================');
  console.log(`SPPG Backend aktif di http://localhost:${PORT}`);
  console.log(`Mode: ${ai ? 'AI + audit lokal' : 'audit lokal tanpa GEMINI_API_KEY'}`);
  console.log('=================================================');
});
