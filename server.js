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

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sppgadmin';
const KOPERASI_USERNAME = process.env.KOPERASI_USERNAME || 'koperasi';
const KOPERASI_PASSWORD = process.env.KOPERASI_PASSWORD || 'sppgkoperasi';

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
  { id: 'KOP-01', namaBarang: 'Beras Medium', satuan: 'Kg', hargaSatuan: 14000, sku: 'BRS-MED-01', stok: 500 },
  { id: 'KOP-02', namaBarang: 'Telur Ayam', satuan: 'Kg', hargaSatuan: 26000, sku: 'TLR-AYM-02', stok: 350 },
  { id: 'KOP-03', namaBarang: 'Minyak Goreng Sunco 2L', satuan: 'Pcs', hargaSatuan: 38000, sku: 'MNG-SNC-03', stok: 200 },
  { id: 'KOP-04', namaBarang: 'Bawang Merah Kupas', satuan: 'Kg', hargaSatuan: 45000, sku: 'BWG-MRH-04', stok: 150 },
  { id: 'KOP-05', namaBarang: 'Bawang Putih Kupas', satuan: 'Kg', hargaSatuan: 40000, sku: 'BWG-PTH-05', stok: 180 },
  { id: 'KOP-06', namaBarang: 'Garam Halus 250g', satuan: 'Bks', hargaSatuan: 2500, sku: 'GRM-HLS-06', stok: 1000 },
  { id: 'KOP-07', namaBarang: 'Merica Bubuk Ladaku', satuan: 'Pcs', hargaSatuan: 1500, sku: 'MRC-LDK-07', stok: 800 },
  { id: 'KOP-08', namaBarang: 'Saos Tiram Saori', satuan: 'Botol', hargaSatuan: 12000, sku: 'SAS-TRM-08', stok: 450 },
];

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
      CREATE TABLE IF NOT EXISTS dapur (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        nama VARCHAR(255) NOT NULL,
        wilayah VARCHAR(100) NOT NULL,
        target_porsi INTEGER NOT NULL,
        batas_anggaran NUMERIC NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'AKTIF'
      );

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

    // Migrasi otomatis: Tambah kolom alamat, email, no_wa ke tabel dapur jika belum ada
    await client.query(`
      ALTER TABLE dapur ADD COLUMN IF NOT EXISTS alamat TEXT;
      ALTER TABLE dapur ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE dapur ADD COLUMN IF NOT EXISTS no_wa VARCHAR(100);
    `);

    // Migrasi otomatis: Tambah kolom bukti_pembayaran jika belum ada
    await client.query(`
      ALTER TABLE koperasi_order ADD COLUMN IF NOT EXISTS bukti_pembayaran TEXT;
    `);

    // Migrasi otomatis: Tambah kolom hari_kirim dan tanggal_kirim jika belum ada
    await client.query(`
      ALTER TABLE koperasi_order ADD COLUMN IF NOT EXISTS hari_kirim VARCHAR(50);
      ALTER TABLE koperasi_order ADD COLUMN IF NOT EXISTS tanggal_kirim DATE;
    `);

    // Migrasi otomatis: Tambah kolom sku dan stok ke koperasi_katalog jika belum ada
    await client.query(`
      ALTER TABLE koperasi_katalog ADD COLUMN IF NOT EXISTS sku VARCHAR(100);
      ALTER TABLE koperasi_katalog ADD COLUMN IF NOT EXISTS stok NUMERIC DEFAULT 0;
      ALTER TABLE koperasi_katalog ADD COLUMN IF NOT EXISTS foto TEXT;
    `);

    // Update SKU dan stok untuk data default jika masih kosong
    await client.query(`
      UPDATE koperasi_katalog SET sku = 'BRS-MED-01', stok = 500 WHERE nama_barang = 'Beras Medium' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'TLR-AYM-02', stok = 350 WHERE nama_barang = 'Telur Ayam' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'MNG-SNC-03', stok = 200 WHERE nama_barang = 'Minyak Goreng Sunco 2L' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'BWG-MRH-04', stok = 150 WHERE nama_barang = 'Bawang Merah Kupas' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'BWG-PTH-05', stok = 180 WHERE nama_barang = 'Bawang Putih Kupas' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'GRM-HLS-06', stok = 1000 WHERE nama_barang = 'Garam Halus 250g' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'MRC-LDK-07', stok = 800 WHERE nama_barang = 'Merica Bubuk Ladaku' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'SAS-TRM-08', stok = 450 WHERE nama_barang = 'Saos Tiram Saori' AND (sku IS NULL OR sku = '');
      UPDATE koperasi_katalog SET sku = 'SKU-GEN-' || id, stok = 100 WHERE sku IS NULL OR sku = '';
    `);

    // Migrasi otomatis: Ubah status PENDING lama ke PENDING_PAYMENT
    await client.query(`
      UPDATE koperasi_order SET status = 'PENDING_PAYMENT' WHERE status = 'PENDING';
    `);

    // Seed default dapur jika tabel dapur kosong
    const countDapurRes = await client.query('SELECT COUNT(*) FROM dapur');
    if (parseInt(countDapurRes.rows[0].count, 10) === 0) {
      for (const item of dapurStore) {
        await client.query(
          'INSERT INTO dapur (id, username, password, nama, wilayah, target_porsi, batas_anggaran, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [item.id, item.username, item.password, item.nama, item.wilayah, item.targetPorsi, item.batasAnggaran, item.status]
        );
      }
      console.log('🌱 Seed data dapur berhasil dimasukkan ke database.');
    }

    // Seed default katalog jika tabel katalog kosong
    const countRes = await client.query('SELECT COUNT(*) FROM koperasi_katalog');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      for (const item of koperasiKatalog) {
        await client.query(
          'INSERT INTO koperasi_katalog (id, nama_barang, satuan, harga_satuan, sku, stok) VALUES ($1, $2, $3, $4, $5, $6)',
          [item.id, item.namaBarang, item.satuan, item.hargaSatuan, item.sku, item.stok]
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

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token autentikasi tidak ditemukan. Silakan login kembali.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Halaman khusus Administrator Yayasan.' });
    }
    req.user = decoded;
    next();
  });
}

function authenticateKoperasiOrAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token autentikasi tidak ditemukan. Silakan login kembali.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || (decoded.role !== 'koperasi' && decoded.role !== 'admin')) {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Halaman khusus Koperasi / Admin.' });
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
  let currentDapurs = dapurStore;
  if (dbActive) {
    try {
      const res = await pool.query('SELECT * FROM dapur ORDER BY id ASC');
      currentDapurs = res.rows.map(row => ({
        id: row.id,
        username: row.username,
        password: row.password,
        nama: row.nama,
        wilayah: row.wilayah,
        targetPorsi: Number(row.target_porsi),
        batasAnggaran: Number(row.batas_anggaran),
        status: row.status
      }));
    } catch (err) {
      console.warn('Gagal memuat dapur dari DB di buildDapurSummary:', err.message);
    }
  }

  const summaries = await Promise.all(
    currentDapurs.map(async (dapur) => {
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

app.get('/api/dapur', async (_req, res) => {
  if (dbActive) {
    try {
      const result = await pool.query('SELECT * FROM dapur ORDER BY id ASC');
      const dbDapurs = result.rows.map(row => ({
        id: row.id,
        username: row.username,
        password: row.password,
        nama: row.nama,
        wilayah: row.wilayah,
        targetPorsi: Number(row.target_porsi),
        batasAnggaran: Number(row.batas_anggaran),
        status: row.status
      }));
      return res.json({ success: true, data: dbDapurs.map(publicDapur) });
    } catch (err) {
      console.error('❌ Gagal memuat dapur dari DB:', err.message);
    }
  }
  res.json({ success: true, data: dapurStore.map(publicDapur) });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').toLowerCase().trim();
  const password = String(req.body?.password || '');

  // 1. Cek Login Admin
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const safeAdmin = { id: 'ADMIN', username: 'admin', nama: 'Administrator Yayasan', role: 'admin' };
    const token = jwt.sign(safeAdmin, JWT_SECRET, { expiresIn: '7d' });
    return res.json({
      success: true,
      message: 'Login Admin Berhasil.',
      token,
      data: safeAdmin,
    });
  }

  // 2. Cek Login Koperasi
  if (username === KOPERASI_USERNAME && password === KOPERASI_PASSWORD) {
    const safeKoperasi = { id: 'KOPERASI', username: 'koperasi', nama: 'Admin Koperasi', role: 'koperasi' };
    const token = jwt.sign(safeKoperasi, JWT_SECRET, { expiresIn: '7d' });
    return res.json({
      success: true,
      message: 'Login Koperasi Berhasil.',
      token,
      data: safeKoperasi,
    });
  }

  let dapur = null;
  if (dbActive) {
    try {
      const result = await pool.query('SELECT * FROM dapur WHERE LOWER(username) = $1 AND password = $2', [username, password]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        dapur = {
          id: row.id,
          username: row.username,
          password: row.password,
          nama: row.nama,
          wilayah: row.wilayah,
          targetPorsi: Number(row.target_porsi),
          batasAnggaran: Number(row.batas_anggaran),
          status: row.status
        };
      }
    } catch (err) {
      console.error('❌ Gagal login dari DB:', err.message);
    }
  } else {
    dapur = dapurStore.find(
      (item) => item.username === username && item.password === password,
    );
  }

  if (!dapur) {
    return res.status(401).json({
      success: false,
      message: 'Username atau password salah.',
    });
  }

  const safeDapur = publicDapur(dapur);
  const token = jwt.sign(safeDapur, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    success: true,
    message: 'Login berhasil.',
    token,
    data: safeDapur,
  });
});

app.put('/api/dapur/profile/password', authenticateToken, async (req, res) => {
  const { passwordBaru } = req.body;
  const idDapur = req.user.id;

  if (!passwordBaru || passwordBaru.trim().length < 4) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 4 karakter.' });
  }

  if (!dbActive) {
    const idx = dapurStore.findIndex(d => d.id === idDapur);
    if (idx !== -1) {
      dapurStore[idx].password = passwordBaru;
      return res.json({ success: true, message: 'Password berhasil diubah (in-memory).' });
    }
    return res.status(404).json({ success: false, message: 'Dapur tidak ditemukan.' });
  }

  try {
    await pool.query(
      `UPDATE dapur 
       SET password = $1
       WHERE id = $2`,
      [passwordBaru, idDapur]
    );
    res.json({ success: true, message: 'Password berhasil diperbarui.' });
  } catch (err) {
    console.error('❌ Gagal memperbarui password dapur:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memperbarui password ke database.' });
  }
});

app.put('/api/dapur/profile', authenticateToken, async (req, res) => {
  const { nama, alamat, email, noWa } = req.body;
  const idDapur = req.user.id;

  if (!dbActive) {
    const idx = dapurStore.findIndex(d => d.id === idDapur);
    if (idx !== -1) {
      if (nama) dapurStore[idx].nama = nama;
      dapurStore[idx].alamat = alamat || '';
      dapurStore[idx].email = email || '';
      dapurStore[idx].no_wa = noWa || '';
      
      const safeDapur = publicDapur(dapurStore[idx]);
      return res.json({ 
        success: true, 
        message: 'Profil berhasil diperbarui (in-memory).',
        data: safeDapur
      });
    }
    return res.status(404).json({ success: false, message: 'Dapur tidak ditemukan.' });
  }

  try {
    const result = await pool.query(
      `UPDATE dapur 
       SET nama = COALESCE(NULLIF($1, ''), nama), alamat = $2, email = $3, no_wa = $4
       WHERE id = $5
       RETURNING *`,
      [nama || '', alamat || '', email || '', noWa || '', idDapur]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dapur tidak ditemukan.' });
    }

    const safeDapur = publicDapur(result.rows[0]);
    res.json({ 
      success: true, 
      message: 'Profil berhasil diperbarui.',
      data: safeDapur
    });
  } catch (err) {
    console.error('❌ Gagal memperbarui profil dapur:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memperbarui profil ke database.' });
  }
});

app.put('/api/dapur/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama, username, password, targetPorsi, batasAnggaran } = req.body;

  if (!nama || !username || !password) {
    return res.status(400).json({ success: false, message: 'Nama, Username, dan Password wajib diisi.' });
  }

  if (!dbActive) {
    const idx = dapurStore.findIndex(d => d.id === id);
    if (idx !== -1) {
      dapurStore[idx] = {
        ...dapurStore[idx],
        nama,
        username: username.toLowerCase().trim(),
        password,
        targetPorsi: Number(targetPorsi) || dapurStore[idx].targetPorsi,
        batasAnggaran: Number(batasAnggaran) || dapurStore[idx].batasAnggaran
      };
      return res.json({ success: true, message: 'Dapur berhasil diperbarui (in-memory).' });
    }
    return res.status(404).json({ success: false, message: 'Dapur tidak ditemukan.' });
  }

  try {
    const checkRes = await pool.query('SELECT * FROM dapur WHERE LOWER(username) = $1 AND id <> $2', [username.toLowerCase().trim(), id]);
    if (checkRes.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan oleh dapur lain.' });
    }

    await pool.query(
      `UPDATE dapur 
       SET nama = $1, username = $2, password = $3, target_porsi = $4, batas_anggaran = $5
       WHERE id = $6`,
      [
        nama, 
        username.toLowerCase().trim(), 
        password, 
        Number(targetPorsi) || 1500, 
        Number(batasAnggaran) || 13500000, 
        id
      ]
    );
    res.json({ success: true, message: 'Data dapur berhasil diperbarui.' });
  } catch (err) {
    console.error('❌ Gagal memperbarui data dapur:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data dapur ke database.' });
  }
});

async function generateAiAdvisory(laporan) {
  const totalRiil = Number(laporan.totalRiil) || 0;
  const auditData = laporan.audit || {};
  const rasioKoperasi = Number(auditData.persenKoperasi) || 0;

  const allItems = laporan.items || [];
  const totalKoperasi = allItems
    .filter((item) => String(item.sumber || '').toUpperCase().includes('KOPERASI'))
    .reduce((sum, item) => sum + Number(item.totalRiil || 0), 0);

  const itemsLuar = allItems.filter((item) => !String(item.sumber || '').toUpperCase().includes('KOPERASI'));

  if (!ai) {
    if (rasioKoperasi >= 50) {
      return `Bagus! Belanja Koperasi Anda mencapai ${rasioKoperasi.toFixed(0)}%, memenuhi target minimal 50%. Pertahankan kinerja ini!`;
    } else {
      if (itemsLuar.length > 0) {
        const itemNames = itemsLuar.slice(0, 2).map(i => i.namaBarang).join(' & ');
        return `Sinyal: Belanja Koperasi baru ${rasioKoperasi.toFixed(0)}% (Target: 50%). Disarankan membeli ${itemNames} di Koperasi SPPG pada belanja berikutnya agar mencapai target.`;
      }
      return `Sinyal: Belanja Koperasi baru ${rasioKoperasi.toFixed(0)}% (Target: 50%). Harap tingkatkan transaksi belanja di Koperasi SPPG.`;
    }
  }

  try {
    const prompt = `
Anda adalah Auditor AI Keuangan untuk Yayasan SPPG.
Target belanja dapur dari koperasi adalah minimal 50% dari total pengeluaran belanja bahan makanan.
Berikut adalah data belanja dapur hari ini:
- Nama Dapur: ${laporan.namaDapur}
- Total Belanja Riil: Rp ${totalRiil.toLocaleString('id-ID')}
- Total Belanja Koperasi: Rp ${totalKoperasi.toLocaleString('id-ID')}
- Rasio Belanja Koperasi saat ini: ${rasioKoperasi.toFixed(1)}%
- Daftar Bahan Makanan yang dibeli di Luar Koperasi:
${itemsLuar.map(i => `- ${i.namaBarang}: Qty ${i.qty} ${i.satuan}, Total Rp ${i.totalRiil.toLocaleString('id-ID')}, Dibeli dari: ${i.sumber}`).join('\n')}

Tugas Anda:
1. Jika Rasio Belanja Koperasi < 50%, berikan sinyal peringatan dan saran tindakan (maksimal 2 kalimat) dalam Bahasa Indonesia yang formal namun ramah. Sebutkan secara spesifik bahan makanan apa saja yang dibeli di luar koperasi hari ini yang sebaiknya dibeli di Koperasi SPPG untuk pembelanjaan berikutnya agar rasio mencapai target 50%.
2. Jika Rasio Belanja Koperasi >= 50%, berikan kalimat apresiasi singkat (maksimal 1 kalimat) dalam Bahasa Indonesia karena telah memenuhi atau melampaui target koperasi.

Format keluaran: Kembalikan teks saran langsung tanpa ada intro, outtro, atau format markdown (seperti **tebal** atau list). Tuliskan dalam bentuk paragraf teks mengalir.
`;

    const responseAI = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const advisory = responseAI.text ? responseAI.text.trim() : '';
    if (advisory) {
      console.log(`✅ [AI Advisory Generated] untuk ${laporan.namaDapur}: "${advisory}"`);
      return advisory;
    }
    throw new Error('Response AI kosong');
  } catch (err) {
    console.error('❌ Gagal menghasilkan AI Advisory:', err.message);
    if (rasioKoperasi >= 50) {
      return `Apresiasi: Belanja Koperasi Anda mencapai ${rasioKoperasi.toFixed(0)}% (Memenuhi target 50%).`;
    } else {
      const itemNames = itemsLuar.slice(0, 2).map(i => i.namaBarang).join(' & ');
      return `Sinyal: Belanja Koperasi baru ${rasioKoperasi.toFixed(0)}% (Target: 50%). Disarankan membeli ${itemNames || 'bahan makanan'} di Koperasi SPPG pada belanja berikutnya.`;
    }
  }
}

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
      
      // Cek apakah fotoNota berupa JSON array string (multiple receipts)
      if (typeof item.fotoNota === 'string' && item.fotoNota.startsWith('[')) {
        try {
          const receipts = JSON.parse(item.fotoNota);
          if (Array.isArray(receipts)) {
            const processedReceipts = receipts.map((r, rIdx) => {
              if (r.foto) {
                r.foto = saveBase64Image(r.foto, `nota-${laporanId}-${index}-rec-${rIdx}-${sanitizedItemName}`);
              }
              return r;
            });
            item.fotoNota = JSON.stringify(processedReceipts);
          }
        } catch (err) {
          console.error('⚠️ Gagal memproses JSON fotoNota:', err.message);
        }
      } else {
        item.fotoNota = saveBase64Image(item.fotoNota, `nota-${laporanId}-${index}-${sanitizedItemName}`);
      }
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

  // Hasilkan rekomendasi AI secara asinkron sebelum menyimpan
  const aiAdvisory = await generateAiAdvisory(laporan);
  laporan.audit.aiAdvisory = aiAdvisory;
  laporan.audit.koperasiWarning = (laporan.audit.persenKoperasi < 50);

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

  // INTEGRASI KLED0: Otomatis sinkronisasi biaya belanja ke Kledo di background (DISEBUTKAN UNTUK DISAMPINGKAN DULU)
  // syncToKledo(laporan);

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
    return { success: false, reason: 'Config missing' };
  }

  const namaDapurTag = laporan.namaDapur || 'Dapur SPPG';
  console.log(`⏳ [Kledo Sync] Memulai sinkronisasi belanja untuk ${namaDapurTag} senilai Rp ${laporan.totalRiil.toLocaleString('id-ID')}...`);

  try {
    // 1. Kueri list tag yang ada di Kledo untuk mencari tag dapur
    const getTagsRes = await fetch(`${kledoUrl}/finance/tags?per_page=1000`, {
      method: 'GET',
      headers: {
        'Authorization': kledoToken,
        'Content-Type': 'application/json'
      }
    });
    
    let tagId = null;
    if (getTagsRes.ok) {
      const getTagsJson = await getTagsRes.json();
      if (getTagsJson.success && getTagsJson.data && Array.isArray(getTagsJson.data.data)) {
        const found = getTagsJson.data.data.find(t => t.name.toLowerCase().trim() === namaDapurTag.toLowerCase().trim());
        if (found) {
          tagId = found.id;
        }
      }
    }

    // 2. Jika tag dapur belum ada di Kledo, buat secara otomatis
    if (!tagId) {
      console.log(`🌱 [Kledo Sync] Tag "${namaDapurTag}" belum terdaftar. Mendaftarkan tag baru di Kledo...`);
      const createTagRes = await fetch(`${kledoUrl}/finance/tags`, {
        method: 'POST',
        headers: {
          'Authorization': kledoToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: namaDapurTag })
      });
      if (createTagRes.ok) {
        const createTagJson = await createTagRes.json();
        if (createTagJson.success && createTagJson.data) {
          tagId = createTagJson.data.id;
          console.log(`✅ [Kledo Sync] Tag baru berhasil didaftarkan dengan ID: ${tagId}`);
        }
      }
    }

    // 3. Susun payload expense dengan tags, contact_id, dan pay_from_finance_account_id
    const payload = {
      contact_id: 1, // POS Customer
      pay_from_finance_account_id: 1, // Kas
      trans_date: laporan.tanggalInput,
      due_date: laporan.tanggalInput,
      is_paid: true,
      memo: `Belanja bahan makanan ${laporan.namaDapur} (LAP: ${laporan.id})`,
      items: [
        {
          finance_account_id: Number(kledoAccountId),
          amount: laporan.totalRiil,
          description: `Total realisasi belanja bahan makanan`
        }
      ],
      tags: tagId ? [Number(tagId)] : []
    };

    // Sertakan attachment jika ada foto nota/masakan
    const attachmentUrl = laporan.items.find(item => item.fotoNota)?.fotoNota || laporan.fotoMasakan || null;
    if (attachmentUrl) {
      // Jika attachment berupa path relatif, arahkan ke URL absolut VPS jika didefinisikan (opsional)
      // Di sini kita kirim saja sebagai referensi teks/string
      payload.attachment = attachmentUrl;
    }

    const response = await fetch(`${kledoUrl}/finance/expenses`, {
      method: 'POST',
      headers: {
        'Authorization': kledoToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let result = await response.json();
    
    // Fallback: Jika gagal karena format attachment, coba kirim ulang tanpa attachment
    if (!response.ok && attachmentUrl) {
      console.warn('⚠️ [Kledo Sync] Gagal kirim dengan attachment, mencoba kembali tanpa attachment...');
      delete payload.attachment;
      const retryRes = await fetch(`${kledoUrl}/finance/expenses`, {
        method: 'POST',
        headers: {
          'Authorization': kledoToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      result = await retryRes.json();
      if (retryRes.ok && result.success) {
        console.log(`✅ [Kledo Sync] Transaksi berhasil tercatat di Kledo (tanpa attachment) dengan ID: ${result.data?.id}`);
        return { success: true, id: result.data?.id, note: 'No attachment fallback used' };
      }
    }

    if (response.ok && result.success) {
      console.log(`✅ [Kledo Sync] Transaksi berhasil tercatat di Kledo dengan ID: ${result.data?.id} (Tag: ${namaDapurTag})`);
      return { success: true, id: result.data?.id };
    } else {
      console.warn(`⚠️ [Kledo Sync] Kledo menolak data: ${result.message || response.statusText}`);
      throw new Error(result.message || response.statusText);
    }
  } catch (error) {
    console.error('❌ [Kledo Sync] Gagal menghubungi server Kledo:', error.message);
    throw error;
  }
}

async function syncKoperasiOrderToKledo(order) {
  const kledoUrl = process.env.KLEDO_API_URL;
  const kledoToken = process.env.KLEDO_API_TOKEN;
  const kledoRevenueAccountId = process.env.KLEDO_REVENUE_ACCOUNT_ID || 121;

  if (!kledoUrl || !kledoToken) {
    console.log('ℹ️ [Kledo Koperasi Sync] Dilewati. Lengkapi KLEDO_API_URL dan TOKEN di file .env untuk mengaktifkan.');
    return { success: false, reason: 'Config missing' };
  }

  const namaDapurTag = order.namaDapur || 'Dapur SPPG';
  console.log(`⏳ [Kledo Koperasi Sync] Memulai sinkronisasi tagihan koperasi untuk ${namaDapurTag} senilai Rp ${order.totalHarga.toLocaleString('id-ID')}...`);

  try {
    // 1. Cari contact (customer) berdasarkan nama dapur di Kledo
    const getContactRes = await fetch(`${kledoUrl}/finance/contacts?per_page=10&search=${encodeURIComponent(namaDapurTag)}`, {
      method: 'GET',
      headers: {
        'Authorization': kledoToken,
        'Content-Type': 'application/json'
      }
    });

    let contactId = null;
    if (getContactRes.ok) {
      const getContactJson = await getContactRes.json();
      if (getContactJson.success && getContactJson.data && Array.isArray(getContactJson.data.data)) {
        const found = getContactJson.data.data.find(c => c.name.toLowerCase().trim() === namaDapurTag.toLowerCase().trim());
        if (found) {
          contactId = found.id;
        }
      }
    }

    // 2. Jika contact dapur belum ada di Kledo, buat secara otomatis
    if (!contactId) {
      console.log(`🌱 [Kledo Koperasi Sync] Contact "${namaDapurTag}" belum terdaftar. Mendaftarkan contact baru di Kledo...`);
      const createContactRes = await fetch(`${kledoUrl}/finance/contacts`, {
        method: 'POST',
        headers: {
          'Authorization': kledoToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: namaDapurTag, type_ids: [3] }) // type_id 3 = customer
      });
      if (createContactRes.ok) {
        const createContactJson = await createContactRes.json();
        if (createContactJson.success && createContactJson.data) {
          contactId = createContactJson.data.id;
          console.log(`✅ [Kledo Koperasi Sync] Contact baru berhasil didaftarkan dengan ID: ${contactId}`);
        }
      }
    }

    // Jika gagal mencari/membuat contact, gunakan POS Customer (ID: 1) sebagai fallback
    if (!contactId) {
      console.warn('⚠️ [Kledo Koperasi Sync] Gagal mendapatkan contact. Menggunakan POS Customer (ID: 1) sebagai fallback...');
      contactId = 1;
    }

    // 3. Susun payload invoice penjualan (Sales Invoice)
    const dateOnly = order.createdAt ? order.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
    const payload = {
      contact_id: Number(contactId),
      trans_date: dateOnly,
      due_date: dateOnly,
      is_paid: false, // Tagihan belum dibayar (Accounts Receivable)
      memo: `Pesanan Kulakan Koperasi ${order.namaDapur} (ORD: ${order.id})`,
      items: order.items.map(item => ({
        finance_account_id: Number(kledoRevenueAccountId),
        amount: item.total,
        description: `${item.namaBarang} - ${item.qty} ${item.satuan} @ Rp ${item.hargaSatuan.toLocaleString('id-ID')}`
      }))
    };

    const response = await fetch(`${kledoUrl}/finance/invoices`, {
      method: 'POST',
      headers: {
        'Authorization': kledoToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.ok && result.success) {
      console.log(`✅ [Kledo Koperasi Sync] Invoice berhasil dibuat di Kledo dengan ID: ${result.data.id}`);
      return { success: true, id: result.data.id };
    } else {
      console.error('❌ [Kledo Koperasi Sync] Gagal membuat invoice di Kledo:', result);
      return { success: false, error: result };
    }
  } catch (err) {
    console.error('❌ [Kledo Koperasi Sync] Gagal selama proses sinkronisasi Kledo:', err.message);
    return { success: false, error: err.message };
  }
}

app.get('/api/laporan', authenticateAdmin, async (req, res) => {
  const data = await filterLaporanByDapur(req.query.idDapur);
  res.json({ success: true, data });
});

app.get('/api/audit', authenticateAdmin, async (req, res) => {
  const reports = await filterLaporanByDapur(req.query.idDapur);
  res.json({ success: true, data: buildAudit(reports) });
});

app.get('/api/dashboard', authenticateAdmin, async (_req, res) => {
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
// KLEDO AUDIT & DASHBOARD APIS
// =========================================================================
app.get('/api/kledo/dashboard', authenticateAdmin, async (req, res) => {
  const kledoUrl = process.env.KLEDO_API_URL;
  const kledoToken = process.env.KLEDO_API_TOKEN;

  if (!kledoUrl || !kledoToken) {
    return res.status(503).json({
      success: false,
      message: 'Integrasi Kledo belum dikonfigurasi di file .env server.'
    });
  }

  try {
    // 1. Ambil data tag dari Kledo
    const tagsRes = await fetch(`${kledoUrl}/finance/tags?per_page=1000`, {
      headers: { 'Authorization': kledoToken }
    });
    if (!tagsRes.ok) throw new Error(`Gagal memuat tags: ${tagsRes.statusText}`);
    const tagsJson = await tagsRes.json();
    const tagsData = tagsJson.data?.data || [];

    // 2. Ambil pengeluaran dari Kledo
    const expensesRes = await fetch(`${kledoUrl}/finance/expenses?per_page=1000`, {
      headers: { 'Authorization': kledoToken }
    });
    if (!expensesRes.ok) throw new Error(`Gagal memuat expenses: ${expensesRes.statusText}`);
    const expensesJson = await expensesRes.json();
    const expensesData = expensesJson.data?.data || [];

    // 3. Ambil laporan belanja lokal
    const localReports = await filterLaporanByDapur('ALL');
    
    // Kelompokkan total pengeluaran riil lokal per idDapur
    const localDapurTotals = {};
    localReports.forEach(r => {
      const id = r.idDapur;
      if (!localDapurTotals[id]) {
        localDapurTotals[id] = { totalRiil: 0, reports: [] };
      }
      localDapurTotals[id].totalRiil += Number(r.totalRiil);
      localDapurTotals[id].reports.push({
        id: r.id,
        tanggalInput: r.tanggalInput,
        totalRiil: Number(r.totalRiil),
        hasKledoSync: false
      });
    });

    // Petakan dapur dengan tag Kledo
    const resultDapurList = dapurStore.map(d => {
      const tag = tagsData.find(t => t.name.toLowerCase().trim() === d.nama.toLowerCase().trim());
      const tagId = tag ? tag.id : null;

      // Filter transaksi pengeluaran Kledo untuk dapur ini
      const dapurExpenses = expensesData.filter(exp => 
        exp.tags && exp.tags.some(t => t.id === tagId || t.name.toLowerCase().trim() === d.nama.toLowerCase().trim())
      );

      const totalKledo = dapurExpenses.reduce((sum, e) => sum + (e.amount_after_tax || e.amount || 0), 0);
      const localData = localDapurTotals[d.id] || { totalRiil: 0, reports: [] };

      // Cari status sync untuk masing-masing laporan
      const reportsMapped = localData.reports.map(rep => {
        const isSynced = expensesData.some(exp => 
          exp.memo && exp.memo.includes(rep.id)
        );
        rep.hasKledoSync = isSynced;
        return rep;
      });

      let statusSync = 'NORMAL';
      if (localData.totalRiil > 0 && totalKledo === 0) {
        statusSync = 'BELUM_SYNC';
      } else if (localData.totalRiil > 0 && Math.abs(totalKledo - localData.totalRiil) > 10) {
        statusSync = 'DEVIASE';
      } else if (localData.totalRiil > 0) {
        statusSync = 'SINKRON';
      }

      return {
        idDapur: d.id,
        namaDapur: d.nama,
        wilayah: d.wilayah,
        kledoTagId: tagId,
        totalRealisasiLokal: localData.totalRiil,
        totalExpensesKledo: totalKledo,
        selisih: totalKledo - localData.totalRiil,
        statusSync,
        transaksiCount: dapurExpenses.length,
        laporanList: reportsMapped,
        expensesList: dapurExpenses.map(e => ({
          id: e.id,
          refNumber: e.ref_number,
          transDate: e.trans_date,
          amount: e.amount_after_tax || e.amount,
          memo: e.memo
        }))
      };
    });

    res.json({
      success: true,
      data: {
        dapurKledoStats: resultDapurList,
        totalExpensesKledoAll: expensesData.reduce((sum, e) => sum + (e.amount_after_tax || e.amount || 0), 0),
        totalRealisasiLokalAll: localReports.reduce((sum, r) => sum + Number(r.totalRiil), 0)
      }
    });

  } catch (err) {
    console.error('❌ Gagal memuat dashboard Kledo:', err.message);
    res.status(500).json({ success: false, message: `Gagal memuat dashboard Kledo: ${err.message}` });
  }
});

app.post('/api/kledo/sync-laporan/:laporanId', authenticateAdmin, async (req, res) => {
  const { laporanId } = req.params;
  const kledoUrl = process.env.KLEDO_API_URL;
  const kledoToken = process.env.KLEDO_API_TOKEN;

  if (!kledoUrl || !kledoToken) {
    return res.status(503).json({
      success: false,
      message: 'Integrasi Kledo belum dikonfigurasi di file .env server.'
    });
  }

  try {
    let laporan = null;
    if (dbActive) {
      const rowRes = await pool.query('SELECT * FROM laporan WHERE id = $1', [laporanId]);
      if (rowRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan di database.' });
      }
      const row = rowRes.rows[0];
      const itemsRes = await pool.query('SELECT * FROM laporan_items WHERE laporan_id = $1', [laporanId]);
      
      laporan = {
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
        items: itemsRes.rows.map(item => ({
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
          flagged: item.flagged
        }))
      };
    } else {
      laporan = laporanStore.find(l => l.id === laporanId);
    }

    if (!laporan) {
      return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan.' });
    }

    const syncRes = await syncToKledo(laporan);
    res.json({
      success: true,
      message: 'Laporan berhasil disinkronisasikan ke Kledo.',
      data: syncRes
    });
  } catch (err) {
    console.error('❌ Gagal sinkronisasi manual ke Kledo:', err.message);
    res.status(500).json({ success: false, message: `Gagal sinkronisasi ke Kledo: ${err.message}` });
  }
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
        hargaSatuan: Number(row.harga_satuan),
        sku: row.sku || '',
        stok: Number(row.stok || 0),
        foto: row.foto || null
      }));
      return res.json({ success: true, data });
    } catch (err) {
      console.error('❌ Gagal ambil katalog dari DB:', err.message);
    }
  }
  res.json({ success: true, data: koperasiKatalog });
});

app.post('/api/koperasi/katalog', authenticateKoperasiOrAdmin, async (req, res) => {
  const { namaBarang, satuan, hargaSatuan, sku, stok, foto } = req.body;
  if (!namaBarang || !satuan || !hargaSatuan) {
    return res.status(400).json({ success: false, message: 'Data produk tidak lengkap.' });
  }

  const cleanNama = String(namaBarang).trim();
  const cleanSatuan = String(satuan).trim();
  const cleanSku = String(sku || '').trim() || `SKU-GEN-${Date.now().toString().slice(-6)}`;
  const numHarga = toNumber(hargaSatuan);
  const numStok = toNumber(stok || 0);

  // Simpan foto jika ada
  let savedFoto = null;
  if (foto) {
    savedFoto = saveBase64Image(foto, `produk-${cleanSku}`);
  }

  if (dbActive) {
    try {
      const countRes = await pool.query('SELECT COUNT(*) FROM koperasi_katalog');
      const newId = `KOP-${String(parseInt(countRes.rows[0].count, 10) + 1).padStart(2, '0')}-${Date.now().toString().slice(-4)}`;
      
      const insertRes = await pool.query(
        'INSERT INTO koperasi_katalog (id, nama_barang, satuan, harga_satuan, sku, stok, foto) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [newId, cleanNama, cleanSatuan, numHarga, cleanSku, numStok, savedFoto]
      );
      
      const row = insertRes.rows[0];
      return res.status(201).json({
        success: true,
        message: 'Produk berhasil diunggah.',
        data: {
          id: row.id,
          namaBarang: row.nama_barang,
          satuan: row.satuan,
          hargaSatuan: Number(row.harga_satuan),
          sku: row.sku || '',
          stok: Number(row.stok || 0),
          foto: row.foto || null
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
    hargaSatuan: numHarga,
    sku: cleanSku,
    stok: numStok,
    foto: savedFoto
  };
  koperasiKatalog.push(newProduct);
  res.status(201).json({ success: true, message: 'Produk berhasil diunggah.', data: newProduct });
});

// Endpoint baru: PUT /api/koperasi/katalog/:id (Edit produk)
app.put('/api/koperasi/katalog/:id', authenticateKoperasiOrAdmin, async (req, res) => {
  const { id } = req.params;
  const { namaBarang, satuan, hargaSatuan, sku, stok, foto } = req.body;

  if (!namaBarang || !satuan || !hargaSatuan) {
    return res.status(400).json({ success: false, message: 'Data produk tidak lengkap.' });
  }

  const cleanNama = String(namaBarang).trim();
  const cleanSatuan = String(satuan).trim();
  const cleanSku = String(sku || '').trim();
  const numHarga = toNumber(hargaSatuan);
  const numStok = toNumber(stok || 0);

  let finalFoto = foto || null;
  if (foto && foto.startsWith('data:image')) {
    finalFoto = saveBase64Image(foto, `produk-${cleanSku}`);
  }

  if (dbActive) {
    try {
      const updateRes = await pool.query(
        `UPDATE koperasi_katalog 
         SET nama_barang = $1, satuan = $2, harga_satuan = $3, sku = $4, stok = $5, foto = COALESCE($6, foto) 
         WHERE id = $7 RETURNING *`,
        [cleanNama, cleanSatuan, numHarga, cleanSku, numStok, finalFoto, id]
      );
      if (updateRes.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
      }
      const row = updateRes.rows[0];
      return res.json({
        success: true,
        message: 'Produk berhasil diperbarui.',
        data: {
          id: row.id,
          namaBarang: row.nama_barang,
          satuan: row.satuan,
          hargaSatuan: Number(row.harga_satuan),
          sku: row.sku || '',
          stok: Number(row.stok || 0),
          foto: row.foto || null
        }
      });
    } catch (err) {
      console.error('❌ Gagal mengedit katalog di DB:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal memperbarui produk.' });
    }
  }

  // Fallback in-memory
  const idx = koperasiKatalog.findIndex(item => item.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
  }
  
  koperasiKatalog[idx] = {
    ...koperasiKatalog[idx],
    namaBarang: cleanNama,
    satuan: cleanSatuan,
    hargaSatuan: numHarga,
    sku: cleanSku,
    stok: numStok,
    foto: finalFoto || koperasiKatalog[idx].foto
  };

  res.json({ success: true, message: 'Produk berhasil diperbarui.', data: koperasiKatalog[idx] });
});

app.delete('/api/koperasi/katalog/:id', authenticateKoperasiOrAdmin, async (req, res) => {
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

app.post('/api/koperasi/order', authenticateToken, async (req, res) => {
  let { idDapur, namaDapur, items, hariKirim, tanggalKirim } = req.body;

  // Keamanan: Paksa agar idDapur sesuai dengan user yang terotentikasi jika bukan admin/koperasi
  if (req.user.role !== 'admin' && req.user.role !== 'koperasi') {
    idDapur = req.user.id;
    namaDapur = req.user.nama;
  }
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
    status: 'PENDING_PAYMENT',
    buktiPembayaran: null,
    hariKirim: hariKirim || null,
    tanggalKirim: tanggalKirim || null,
    createdAt: new Date().toISOString()
  };

  if (dbActive) {
    try {
      await pool.query(
        'INSERT INTO koperasi_order (id, id_dapur, nama_dapur, total_harga, status, created_at, hari_kirim, tanggal_kirim) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [order.id, order.idDapur, order.namaDapur, order.totalHarga, order.status, order.createdAt, order.hariKirim, order.tanggalKirim]
      );

      for (const item of order.items) {
        await pool.query(
          'INSERT INTO koperasi_order_items (order_id, nama_barang, qty, satuan, harga_satuan, total) VALUES ($1, $2, $3, $4, $5, $6)',
          [order.id, item.namaBarang, item.qty, item.satuan, item.hargaSatuan, item.total]
        );
      }

      // Auto sync to Kledo Sales Invoice in the background (DISAMPINGKAN DULU)
      // syncKoperasiOrderToKledo(order).catch(err => console.error('Background Kledo Sales Invoice Sync error:', err));

      return res.json({ success: true, message: 'Pre Order Koperasi berhasil dibuat.', data: order });
    } catch (err) {
      console.error('❌ Gagal menyimpan order ke DB:', err.message);
    }
  }

  // Fallback in-memory
  orderStore.unshift(order);
  // syncKoperasiOrderToKledo(order).catch(err => console.error('Background Kledo Sales Invoice Sync error:', err));
  res.json({ success: true, message: 'Pre Order Koperasi berhasil dibuat.', data: order });
});

// Endpoint baru: Upload Bukti Pembayaran
app.post('/api/koperasi/order/:id/pembayaran', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { buktiPembayaran } = req.body;

  if (!buktiPembayaran) {
    return res.status(400).json({ success: false, message: 'Bukti pembayaran tidak ditemukan.' });
  }

  let order = null;
  if (dbActive) {
    try {
      const checkRes = await pool.query('SELECT * FROM koperasi_order WHERE id = $1', [id]);
      if (checkRes.rows.length > 0) {
        order = checkRes.rows[0];
      }
    } catch (dbErr) {
      console.error(dbErr);
    }
  } else {
    order = orderStore.find(o => o.id === id);
  }

  if (!order) {
    return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
  }

  const orderDapurId = dbActive ? order.id_dapur : order.idDapur;
  if (req.user.role !== 'admin' && req.user.role !== 'koperasi' && req.user.id !== orderDapurId) {
    return res.status(403).json({ success: false, message: 'Akses ditolak.' });
  }

  const filename = saveBase64Image(buktiPembayaran, `bukti-bayar-${id}`);

  if (dbActive) {
    try {
      await pool.query(
        "UPDATE koperasi_order SET status = 'WAITING_APPROVAL', bukti_pembayaran = $1 WHERE id = $2",
        [filename, id]
      );
    } catch (dbErr) {
      console.error('Failed to update payment proof in DB:', dbErr);
      return res.status(500).json({ success: false, message: 'Gagal memperbarui database.' });
    }
  } else {
    order.buktiPembayaran = filename;
    order.status = 'WAITING_APPROVAL';
  }

  res.json({
    success: true,
    message: 'Bukti pembayaran berhasil diunggah. Menunggu persetujuan Koperasi.',
    buktiPembayaran: filename
  });
});

// Endpoint baru: Upload Bukti Pembayaran Massal / Gabungan
app.post('/api/koperasi/orders/pembayaran-massal', authenticateToken, async (req, res) => {
  const { orderIds, buktiPembayaran } = req.body;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ success: false, message: 'Daftar order ID tidak valid.' });
  }

  if (!buktiPembayaran) {
    return res.status(400).json({ success: false, message: 'Bukti pembayaran tidak ditemukan.' });
  }

  // Simpan foto bukti pembayaran menggunakan ID pertama sebagai penamaan file
  const filename = saveBase64Image(buktiPembayaran, `bukti-bayar-massal-${orderIds[0]}`);

  if (dbActive) {
    try {
      // Pastikan semua order milik dapur yang bersangkutan jika bukan admin/koperasi
      if (req.user.role !== 'admin' && req.user.role !== 'koperasi') {
        const checkRes = await pool.query(
          'SELECT COUNT(*) FROM koperasi_order WHERE id = ANY($1) AND id_dapur = $2',
          [orderIds, req.user.id]
        );
        if (parseInt(checkRes.rows[0].count, 10) !== orderIds.length) {
          return res.status(403).json({ success: false, message: 'Ada pesanan yang bukan milik Dapur Anda atau tidak valid.' });
        }
      }

      await pool.query(
        "UPDATE koperasi_order SET status = 'WAITING_APPROVAL', bukti_pembayaran = $1 WHERE id = ANY($2)",
        [filename, orderIds]
      );
    } catch (dbErr) {
      console.error('Failed to update mass payment proof in DB:', dbErr);
      return res.status(500).json({ success: false, message: 'Gagal memperbarui database.' });
    }
  } else {
    // Fallback in-memory
    orderIds.forEach(id => {
      const order = orderStore.find(o => o.id === id);
      if (order) {
        order.buktiPembayaran = filename;
        order.status = 'WAITING_APPROVAL';
      }
    });
  }

  res.json({
    success: true,
    message: 'Bukti pembayaran gabungan berhasil diunggah. Menunggu persetujuan Koperasi.',
    buktiPembayaran: filename
  });
});

app.get('/api/koperasi/order', authenticateToken, async (req, res) => {
  let { idDapur, status } = req.query;

  // Keamanan: Jika bukan Admin/Koperasi, paksa agar hanya bisa melihat data miliknya sendiri
  if (req.user.role !== 'admin' && req.user.role !== 'koperasi') {
    idDapur = req.user.id;
  }

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
          buktiPembayaran: row.bukti_pembayaran || null,
          hariKirim: row.hari_kirim || null,
          tanggalKirim: row.tanggal_kirim ? new Date(row.tanggal_kirim).toISOString().split('T')[0] : null,
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
  res.json({ success: true, data: filtered.map(o => ({
    ...o,
    buktiPembayaran: o.buktiPembayaran || null,
    hariKirim: o.hariKirim || null,
    tanggalKirim: o.tanggalKirim || null
  })) });
});

app.post('/api/koperasi/order/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const user = req.user;

  let order = null;
  if (dbActive) {
    try {
      const orderRes = await pool.query('SELECT * FROM koperasi_order WHERE id = $1', [id]);
      if (orderRes.rows.length > 0) {
        order = orderRes.rows[0];
      }
    } catch (err) {
      console.error(err);
    }
  } else {
    order = orderStore.find(o => o.id === id);
  }

  if (!order) {
    return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
  }

  const orderDapurId = dbActive ? order.id_dapur : order.idDapur;

  // Cek Otorisasi:
  // - Jika status = SELESAI, boleh dilakukan oleh Koperasi, Admin, atau Dapur pemilik order
  // - Selain itu (DIKIRIM, APPROVED), hanya boleh dilakukan oleh Koperasi atau Admin
  if (status === 'SELESAI') {
    if (user.role !== 'admin' && user.role !== 'koperasi' && user.id !== orderDapurId) {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Hanya pemilik pesanan atau koperasi yang bisa menyelesaikan.' });
    }
  } else {
    if (user.role !== 'admin' && user.role !== 'koperasi') {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Koperasi / Admin.' });
    }
  }

  if (dbActive) {
    try {
      // Kurangi stok di koperasi_katalog jika status diubah menjadi APPROVED
      if (status === 'APPROVED' && order.status !== 'APPROVED' && order.status !== 'DIKIRIM' && order.status !== 'SELESAI') {
        const itemsRes = await pool.query('SELECT * FROM koperasi_order_items WHERE order_id = $1', [id]);
        for (const item of itemsRes.rows) {
          await pool.query(
            'UPDATE koperasi_katalog SET stok = GREATEST(0, stok - $1) WHERE nama_barang = $2',
            [Number(item.qty), item.nama_barang]
          );
        }
      }

      const updateRes = await pool.query(
        'UPDATE koperasi_order SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );
      
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
          buktiPembayaran: row.bukti_pembayaran || null,
          hariKirim: row.hari_kirim || null,
          tanggalKirim: row.tanggal_kirim ? new Date(row.tanggal_kirim).toISOString().split('T')[0] : null,
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
      return res.status(500).json({ success: false, message: 'Gagal mengubah status.' });
    }
  }

  // Fallback in-memory
  if (status === 'APPROVED' && order.status !== 'APPROVED' && order.status !== 'DIKIRIM' && order.status !== 'SELESAI') {
    for (const item of order.items) {
      const prod = koperasiKatalog.find(p => p.namaBarang === item.namaBarang);
      if (prod) prod.stok = Math.max(0, prod.stok - item.qty);
    }
  }
  order.status = status;
  res.json({ success: true, message: `Status pesanan diupdate menjadi ${status}.`, data: {
    ...order,
    buktiPembayaran: order.buktiPembayaran || null,
    hariKirim: order.hariKirim || null,
    tanggalKirim: order.tanggalKirim || null
  } });
});

app.post('/api/anggaran/upload-rab', authenticateAdmin, async (req, res) => {
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
