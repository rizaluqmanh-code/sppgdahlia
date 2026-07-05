const path = require('path');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { Pool } = require('pg');

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch {
  GoogleGenAI = null;
}

const JWT_SECRET = process.env.JWT_SECRET || 'sppg_super_secret_key_13579';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Setup directory uploads untuk foto fisik
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const ai = process.env.GEMINI_API_KEY && GoogleGenAI
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// Database Connection Pool
let pool = null;
let dbActive = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Gunakan SSL jika terhubung ke cloud database (seperti Supabase/Neon)
    ssl: process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('supabase') || process.env.DATABASE_URL.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : false
  });
}

// Global In-Memory Fallback Stores (Tetap digunakan jika database offline)
let laporanStore = [];
let orderStore = [];
let gudangStokStore = [];
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

// Inisialisasi Skema Tabel Database saat server dijalankan
async function initDb() {
  if (!pool) {
    console.log('ℹ️ DATABASE_URL tidak diatur di .env. Menggunakan mode in-memory (RAM).');
    return;
  }

  try {
    const client = await pool.connect();
    console.log('✅ Berhasil terhubung ke database PostgreSQL.');
    dbActive = true;

    // Buat tabel-tabel utama
    await client.query(`
      CREATE TABLE IF NOT EXISTS koperasi_katalog (
        id VARCHAR(50) PRIMARY KEY,
        nama_barang VARCHAR(255) NOT NULL,
        satuan VARCHAR(50) NOT NULL,
        harga_satuan NUMERIC NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gudang_stok (
        id_dapur VARCHAR(50) NOT NULL,
        nama_barang VARCHAR(255) NOT NULL,
        qty NUMERIC NOT NULL,
        satuan VARCHAR(50) NOT NULL,
        harga_satuan NUMERIC NOT NULL,
        PRIMARY KEY (id_dapur, nama_barang)
      );

      CREATE TABLE IF NOT EXISTS laporan (
        id VARCHAR(50) PRIMARY KEY,
        id_dapur VARCHAR(50) NOT NULL,
        nama_dapur VARCHAR(255) NOT NULL,
        tanggal_input DATE NOT NULL,
        target_porsi INTEGER NOT NULL,
        batas_anggaran NUMERIC NOT NULL,
        foto_masakan TEXT,
        total_rab NUMERIC NOT NULL,
        total_riil NUMERIC NOT NULL,
        hpp_riil NUMERIC NOT NULL,
        hpp_rab NUMERIC NOT NULL,
        created_at TIMESTAMP NOT NULL,
        audit JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS laporan_items (
        id SERIAL PRIMARY KEY,
        laporan_id VARCHAR(50) REFERENCES laporan(id) ON DELETE CASCADE,
        nama_barang VARCHAR(255) NOT NULL,
        qty NUMERIC NOT NULL,
        satuan VARCHAR(50) NOT NULL,
        harga_rab NUMERIC NOT NULL,
        total_rab NUMERIC NOT NULL,
        total_riil NUMERIC NOT NULL,
        sumber VARCHAR(50) NOT NULL,
        foto_nota TEXT,
        catatan TEXT,
        selisih NUMERIC NOT NULL,
        deviasi_persen NUMERIC NOT NULL,
        flagged BOOLEAN NOT NULL
      );

      CREATE TABLE IF NOT EXISTS koperasi_order (
        id VARCHAR(50) PRIMARY KEY,
        id_dapur VARCHAR(50) NOT NULL,
        nama_dapur VARCHAR(255) NOT NULL,
        total_harga NUMERIC NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL
      );

      CREATE TABLE IF NOT EXISTS koperasi_order_items (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) REFERENCES koperasi_order(id) ON DELETE CASCADE,
        nama_barang VARCHAR(255) NOT NULL,
        qty NUMERIC NOT NULL,
        satuan VARCHAR(50) NOT NULL,
        harga_satuan NUMERIC NOT NULL,
        total NUMERIC NOT NULL
      );
    `);

    // Seed default katalog jika tabel katalog kosong
    const countRes = await client.query('SELECT COUNT(*) FROM koperasi_katalog');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      for (const item of koperasiKatalog) {
        await client.query(
          'INSERT INTO koperasi_katalog (id, nama_barang, satuan, harga_satuan) VALUES ($1, $2, $3, $4)',
          [item.id, item.namaBarang, item.satuan, item.hargaSatuan]
        );
      }
      console.log('🌱 Seed data katalog koperasi berhasil dimasukkan ke database.');
    }

    client.release();
  } catch (err) {
    console.warn('⚠️ Gagal terhubung/inisialisasi tabel PostgreSQL:', err.message);
    console.log('👉 Server otomatis menggunakan mode aman fallback: In-Memory (RAM).');
    dbActive = false;
  }
}

// Jalankan inisialisasi database
initDb();

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

// Helper untuk mendekode gambar base64 dan menyimpannya secara fisik di disk server
function saveBase64Image(base64Str, prefix) {
  if (!base64Str || typeof base64Str !== 'string') return base64Str;
  if (!base64Str.startsWith('data:image')) {
    // Jika sudah berupa URL path relatif (/uploads/...) kembalikan saja
    return base64Str;
  }

  try {
    const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return base64Str;

    const ext = matches[1].split('/')[1] || 'jpg';
    const imageBuffer = Buffer.from(matches[2], 'base64');
    
    // Tentukan nama file yang unik
    const filename = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
    const filepath = path.join(uploadsDir, filename);

    fs.writeFileSync(filepath, imageBuffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.error('⚠️ Gagal menyimpan base64 ke disk server:', err.message);
    return base64Str;
  }
}

// Middleware otentikasi token JWT untuk mengamankan API
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token autentikasi tidak ditemukan. Silakan login kembali.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Sesi kedaluwarsa atau token tidak valid. Silakan login ulang.' });
    }
    req.user = decoded;
    next();
  });
}

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

async function filterLaporanByDapur(idDapur) {
  if (!dbActive) {
    if (!idDapur || idDapur === 'ALL') return laporanStore;
    return laporanStore.filter((entry) => entry.idDapur === idDapur);
  }

  try {
    let query = 'SELECT * FROM laporan';
    const params = [];

    if (idDapur && idDapur !== 'ALL') {
      query += ' WHERE id_dapur = $1';
      params.push(idDapur);
    }
    query += ' ORDER BY created_at DESC';

    const res = await pool.query(query, params);
    const reports = [];

    for (const row of res.rows) {
      // Ambil items untuk setiap laporan
      const itemsRes = await pool.query('SELECT * FROM laporan_items WHERE laporan_id = $1', [row.id]);
      reports.push({
        id: row.id,
        idDapur: row.id_dapur,
        namaDapur: row.nama_dapur,
        tanggalInput: formatDateKey(row.tanggal_input),
        targetPorsi: row.target_porsi,
        batasAnggaran: Number(row.batas_anggaran),
        fotoMasakan: row.foto_masakan,
        totalRab: Number(row.total_rab),
        totalRiil: Number(row.total_riil),
        hppRiil: Number(row.hpp_riil),
        hppRab: Number(row.hpp_rab),
        createdAt: row.created_at.toISOString(),
        audit: row.audit,
        items: itemsRes.rows.map((item) => ({
          id: item.id,
          namaBarang: item.nama_barang,
          qty: Number(item.qty),
          satuan: item.satuan,
          hargaRab: Number(item.harga_rab),
          totalRab: Number(item.total_rab),
          totalRiil: Number(item.total_riil),
          sumber: item.sumber,
          fotoNota: item.foto_nota,
          catatan: item.catatan || '',
          selisih: Number(item.selisih),
          deviasiPersen: Number(item.deviasi_persen),
          flagged: item.flagged,
        })),
      });
    }

    return reports;
  } catch (err) {
    console.error('❌ Gagal mengambil laporan dari DB:', err.message);
    // Fallback ke memori jika DB error tiba-tiba
    if (!idDapur || idDapur === 'ALL') return laporanStore;
    return laporanStore.filter((entry) => entry.idDapur === idDapur);
  }
}

async function buildDapurSummary() {
  const summaries = await Promise.all(
    dapurStore.map(async (dapur) => {
      const laporanDapur = await filterLaporanByDapur(dapur.id);
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
    })
  );
  return summaries;
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

  // Buat Token JWT yang valid selama 7 hari
  const safeDapur = publicDapur(dapur);
  const token = jwt.sign(safeDapur, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    success: true,
    message: 'Login berhasil.',
    token,
    data: safeDapur,
  });
});

app.post('/api/laporan', authenticateToken, async (req, res) => {
  const payload = req.body || {};
  const items = normalizeItems(payload.items || (payload.namaBarang ? [payload] : []));

  if (!payload.idDapur && !payload.dapur) {
    return res.status(400).json({ success: false, message: 'idDapur wajib diisi.' });
  }

  if (!items.length) {
    return res.status(400).json({ success: false, message: 'Minimal satu item laporan wajib dikirim.' });
  }

  const laporanId = `LAP-${Date.now()}`;

  // Simpan foto nota biner ke disk secara fisik
  const processedItems = items.map((item, index) => {
    if (item.fotoNota) {
      const sanitizedItemName = String(item.namaBarang).replace(/[^a-zA-Z0-9_-]/g, '_');
      item.fotoNota = saveBase64Image(item.fotoNota, `nota-${laporanId}-${index}-${sanitizedItemName}`);
    }
    return item;
  });

  // Simpan foto masakan matang biner ke disk secara fisik
  const processedFotoMasakan = payload.fotoMasakan
    ? saveBase64Image(payload.fotoMasakan, `masakan-${laporanId}`)
    : null;

  const laporan = {
    id: laporanId,
    idDapur: payload.idDapur || payload.dapur,
    namaDapur: payload.namaDapur || payload.dapur || payload.idDapur,
    tanggalInput: formatDateKey(payload.tanggalInput),
    targetPorsi: toNumber(payload.targetPorsi),
    batasAnggaran: toNumber(payload.batasAnggaran),
    fotoMasakan: processedFotoMasakan,
    items: processedItems,
    createdAt: new Date().toISOString(),
  };

  laporan.totalRab = items.reduce((sum, item) => sum + item.totalRab, 0);
  laporan.totalRiil = items.reduce((sum, item) => sum + item.totalRiil, 0);
  laporan.hppRiil = laporan.targetPorsi > 0 ? laporan.totalRiil / laporan.targetPorsi : 0;
  laporan.hppRab = laporan.targetPorsi > 0
    ? (laporan.batasAnggaran || laporan.totalRab) / laporan.targetPorsi
    : 0;
  laporan.audit = buildAudit([laporan]);

  // Simpan ke Database jika aktif
  if (dbActive) {
    try {
      await pool.query(
        `INSERT INTO laporan (
          id, id_dapur, nama_dapur, tanggal_input, target_porsi, batas_anggaran, 
          foto_masakan, total_rab, total_riil, hpp_riil, hpp_rab, created_at, audit
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          laporan.id,
          laporan.idDapur,
          laporan.namaDapur,
          laporan.tanggalInput,
          laporan.targetPorsi,
          laporan.batasAnggaran,
          laporan.fotoMasakan,
          laporan.totalRab,
          laporan.totalRiil,
          laporan.hppRiil,
          laporan.hppRab,
          laporan.createdAt,
          JSON.stringify(laporan.audit)
        ]
      );

      for (const item of items) {
        await pool.query(
          `INSERT INTO laporan_items (
            laporan_id, nama_barang, qty, satuan, harga_rab, total_rab, total_riil, 
            sumber, foto_nota, catatan, selisih, deviasi_persen, flagged
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            laporan.id,
            item.namaBarang,
            item.qty,
            item.satuan,
            item.hargaRab,
            item.totalRab,
            item.totalRiil,
            item.sumber,
            item.fotoNota,
            item.catatan,
            item.selisih,
            item.deviasiPersen,
            item.flagged
          ]
        );
      }
    } catch (dbErr) {
      console.error('❌ Gagal menulis laporan ke DB. Fallback ke RAM.', dbErr.message);
      laporanStore.unshift(laporan);
    }
  } else {
    laporanStore.unshift(laporan);
  }

  // Pengurangan kuantitas stok gudang untuk item-item yang bersumber dari AMBIL_GUDANG
  for (const item of items) {
    if (item.sumber === 'AMBIL_GUDANG') {
      const decreaseQty = item.qty;
      if (dbActive) {
        try {
          const currentRes = await pool.query(
            'SELECT qty FROM gudang_stok WHERE id_dapur = $1 AND nama_barang = $2',
            [laporan.idDapur, item.namaBarang]
          );
          if (currentRes.rows.length > 0) {
            const currentQty = Number(currentRes.rows[0].qty);
            const newQty = Math.max(0, currentQty - decreaseQty);
            if (newQty <= 0) {
              await pool.query(
                'DELETE FROM gudang_stok WHERE id_dapur = $1 AND nama_barang = $2',
                [laporan.idDapur, item.namaBarang]
              );
            } else {
              await pool.query(
                'UPDATE gudang_stok SET qty = $1 WHERE id_dapur = $2 AND nama_barang = $3',
                [newQty, laporan.idDapur, item.namaBarang]
              );
            }
          }
        } catch (stokErr) {
          console.error('❌ Gagal memotong stok gudang di database:', stokErr.message);
        }
      } else {
        // Fallback RAM
        const idx = gudangStokStore.findIndex(g => g.idDapur === laporan.idDapur && g.namaBarang === item.namaBarang);
        if (idx !== -1) {
          gudangStokStore[idx].qty = Math.max(0, gudangStokStore[idx].qty - decreaseQty);
          if (gudangStokStore[idx].qty <= 0) {
            gudangStokStore.splice(idx, 1);
          }
        }
      }
    }
  }

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

app.get('/api/laporan', async (req, res) => {
  const data = await filterLaporanByDapur(req.query.idDapur);
  res.json({ success: true, data });
});

app.get('/api/audit', async (req, res) => {
  const reports = await filterLaporanByDapur(req.query.idDapur);
  res.json({ success: true, data: buildAudit(reports) });
});

app.get('/api/dashboard', async (_req, res) => {
  const reports = await filterLaporanByDapur('ALL');
  const summaries = await buildDapurSummary();
  res.json({
    success: true,
    data: {
      audit: buildAudit(reports),
      dapur: summaries,
      laporan: reports,
    },
  });
});

// =========================================================================
// GUDANG STOK APIS
// =========================================================================
app.get('/api/gudang/stok', authenticateToken, async (req, res) => {
  const idDapur = req.query.idDapur;
  if (!idDapur) {
    return res.status(400).json({ success: false, error: 'idDapur wajib diisi.' });
  }

  if (dbActive) {
    try {
      const resDb = await pool.query(
        'SELECT nama_barang AS "namaBarang", qty, satuan, harga_satuan AS "hargaSatuan" FROM gudang_stok WHERE id_dapur = $1 ORDER BY nama_barang ASC',
        [idDapur]
      );
      return res.json({ success: true, data: resDb.rows.map(r => ({ ...r, qty: Number(r.qty), hargaSatuan: Number(r.hargaSatuan) })) });
    } catch (err) {
      console.error('❌ Gagal membaca gudang_stok dari DB:', err.message);
    }
  }

  // Fallback RAM
  const filtered = gudangStokStore.filter(item => item.idDapur === idDapur);
  res.json({ success: true, data: filtered });
});

app.post('/api/gudang/stok', authenticateToken, async (req, res) => {
  const { idDapur, items } = req.body || {};
  if (!idDapur || !Array.isArray(items)) {
    return res.status(400).json({ success: false, error: 'idDapur dan items array wajib diisi.' });
  }

  if (dbActive) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        const qty = toNumber(item.qty);
        const hargaSatuan = toNumber(item.hargaSatuan);
        
        // Simpan foto nota jika ada di input stok mandiri
        let processedFotoNota = item.fotoNota || null;
        if (processedFotoNota && processedFotoNota.startsWith('data:image')) {
          processedFotoNota = saveBase64Image(processedFotoNota, `nota-gudang-${idDapur}`);
        }

        if (qty <= 0) {
          // Hapus dari stok jika qty <= 0
          await client.query(
            'DELETE FROM gudang_stok WHERE id_dapur = $1 AND nama_barang = $2',
            [idDapur, item.namaBarang]
          );
        } else {
          await client.query(
            `INSERT INTO gudang_stok (id_dapur, nama_barang, qty, satuan, harga_satuan)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id_dapur, nama_barang)
             DO UPDATE SET qty = EXCLUDED.qty, harga_satuan = EXCLUDED.harga_satuan, satuan = EXCLUDED.satuan`,
            [idDapur, item.namaBarang, qty, item.satuan || '', hargaSatuan]
          );
        }
      }
      await client.query('COMMIT');
      client.release();
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      console.error('❌ Gagal menyimpan/mengupdate gudang_stok ke DB:', err.message);
      return res.status(500).json({ success: false, error: 'Gagal memperbarui stok di database.' });
    }
  } else {
    // Fallback RAM
    for (const item of items) {
      const qty = toNumber(item.qty);
      const idx = gudangStokStore.findIndex(g => g.idDapur === idDapur && g.namaBarang === item.namaBarang);
      
      if (qty <= 0) {
        if (idx !== -1) gudangStokStore.splice(idx, 1);
      } else {
        const newStok = {
          idDapur,
          namaBarang: item.namaBarang,
          qty,
          satuan: item.satuan || '',
          hargaSatuan: toNumber(item.hargaSatuan)
        };
        if (idx !== -1) {
          gudangStokStore[idx] = newStok;
        } else {
          gudangStokStore.push(newStok);
        }
      }
    }
  }

  res.json({ success: true, message: 'Stok berhasil diperbarui.' });
});

// =========================================================================
// KOPERASI MARKETPLACE APIS
// =========================================================================

app.get('/api/koperasi/katalog', async (_req, res) => {
  if (dbActive) {
    try {
      const dbRes = await pool.query('SELECT * FROM koperasi_katalog ORDER BY id ASC');
      const data = dbRes.rows.map(row => ({
        id: row.id,
        namaBarang: row.nama_barang,
        satuan: row.satuan,
        hargaSatuan: Number(row.harga_satuan)
      }));
      return res.json({ success: true, data });
    } catch (err) {
      console.error('❌ Gagal ambil katalog dari DB:', err.message);
    }
  }
  res.json({ success: true, data: koperasiKatalog });
});

app.post('/api/koperasi/katalog', async (req, res) => {
  const { namaBarang, satuan, hargaSatuan } = req.body;
  if (!namaBarang || !satuan || !hargaSatuan) {
    return res.status(400).json({ success: false, message: 'Data produk tidak lengkap.' });
  }

  const cleanNama = String(namaBarang).trim();
  const cleanSatuan = String(satuan).trim();
  const numHarga = toNumber(hargaSatuan);

  if (dbActive) {
    try {
      const countRes = await pool.query('SELECT COUNT(*) FROM koperasi_katalog');
      const newId = `KOP-${String(parseInt(countRes.rows[0].count, 10) + 1).padStart(2, '0')}-${Date.now().toString().slice(-4)}`;
      
      const insertRes = await pool.query(
        'INSERT INTO koperasi_katalog (id, nama_barang, satuan, harga_satuan) VALUES ($1, $2, $3, $4) RETURNING *',
        [newId, cleanNama, cleanSatuan, numHarga]
      );
      
      const row = insertRes.rows[0];
      return res.status(201).json({
        success: true,
        message: 'Produk berhasil diunggah.',
        data: {
          id: row.id,
          namaBarang: row.nama_barang,
          satuan: row.satuan,
          hargaSatuan: Number(row.harga_satuan)
        }
      });
    } catch (err) {
      console.error('❌ Gagal upload katalog ke DB:', err.message);
    }
  }

  // Fallback in-memory
  const newProduct = {
    id: `KOP-${String(koperasiKatalog.length + 1).padStart(2, '0')}-${Date.now().toString().slice(-4)}`,
    namaBarang: cleanNama,
    satuan: cleanSatuan,
    hargaSatuan: numHarga
  };
  koperasiKatalog.push(newProduct);
  res.status(201).json({ success: true, message: 'Produk berhasil diunggah.', data: newProduct });
});

app.delete('/api/koperasi/katalog/:id', async (req, res) => {
  const { id } = req.params;

  if (dbActive) {
    try {
      const deleteRes = await pool.query('DELETE FROM koperasi_katalog WHERE id = $1', [id]);
      if (deleteRes.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
      }
      return res.json({ success: true, message: 'Produk berhasil dihapus.' });
    } catch (err) {
      console.error('❌ Gagal hapus katalog dari DB:', err.message);
    }
  }

  // Fallback in-memory
  const initialLength = koperasiKatalog.length;
  koperasiKatalog = koperasiKatalog.filter(item => item.id !== id);

  if (koperasiKatalog.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
  }
  res.json({ success: true, message: 'Produk berhasil dihapus.' });
});

app.post('/api/koperasi/order', async (req, res) => {
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

  if (dbActive) {
    try {
      await pool.query(
        'INSERT INTO koperasi_order (id, id_dapur, nama_dapur, total_harga, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [order.id, order.idDapur, order.namaDapur, order.totalHarga, order.status, order.createdAt]
      );

      for (const item of order.items) {
        await pool.query(
          'INSERT INTO koperasi_order_items (order_id, nama_barang, qty, satuan, harga_satuan, total) VALUES ($1, $2, $3, $4, $5, $6)',
          [order.id, item.namaBarang, item.qty, item.satuan, item.hargaSatuan, item.total]
        );
      }
      return res.json({ success: true, message: 'Pesanan kulakan berhasil dibuat.', data: order });
    } catch (err) {
      console.error('❌ Gagal menyimpan order ke DB:', err.message);
    }
  }

  // Fallback in-memory
  orderStore.unshift(order);
  res.json({ success: true, message: 'Pesanan kulakan berhasil dibuat.', data: order });
});

app.get('/api/koperasi/order', async (req, res) => {
  const { idDapur, status } = req.query;

  if (dbActive) {
    try {
      let query = 'SELECT * FROM koperasi_order';
      const params = [];
      const conditions = [];

      if (idDapur) {
        conditions.push(`id_dapur = $${params.length + 1}`);
        params.push(idDapur);
      }
      if (status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY created_at DESC';

      const ordersRes = await pool.query(query, params);
      const orders = [];

      for (const row of ordersRes.rows) {
        const itemsRes = await pool.query('SELECT * FROM koperasi_order_items WHERE order_id = $1', [row.id]);
        orders.push({
          id: row.id,
          idDapur: row.id_dapur,
          namaDapur: row.nama_dapur,
          totalHarga: Number(row.total_harga),
          status: row.status,
          createdAt: row.created_at.toISOString(),
          items: itemsRes.rows.map(item => ({
            namaBarang: item.nama_barang,
            qty: Number(item.qty),
            satuan: item.satuan,
            hargaSatuan: Number(item.harga_satuan),
            total: Number(item.total)
          }))
        });
      }

      return res.json({ success: true, data: orders });
    } catch (err) {
      console.error('❌ Gagal mengambil order dari DB:', err.message);
    }
  }

  // Fallback in-memory
  let filtered = orderStore;
  if (idDapur) {
    filtered = filtered.filter(o => o.idDapur === idDapur);
  }
  if (status) {
    filtered = filtered.filter(o => o.status === status);
  }
  res.json({ success: true, data: filtered });
});

app.post('/api/koperasi/order/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (dbActive) {
    try {
      const updateRes = await pool.query(
        'UPDATE koperasi_order SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );
      if (updateRes.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
      }
      
      const row = updateRes.rows[0];
      const itemsRes = await pool.query('SELECT * FROM koperasi_order_items WHERE order_id = $1', [id]);
      
      return res.json({
        success: true,
        message: `Status pesanan diupdate menjadi ${status}.`,
        data: {
          id: row.id,
          idDapur: row.id_dapur,
          namaDapur: row.nama_dapur,
          totalHarga: Number(row.total_harga),
          status: row.status,
          createdAt: row.created_at.toISOString(),
          items: itemsRes.rows.map(item => ({
            namaBarang: item.nama_barang,
            qty: Number(item.qty),
            satuan: item.satuan,
            hargaSatuan: Number(item.harga_satuan),
            total: Number(item.total)
          }))
        }
      });
    } catch (err) {
      console.error('❌ Gagal update status order di DB:', err.message);
    }
  }

  // Fallback in-memory
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
