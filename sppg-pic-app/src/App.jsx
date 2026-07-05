import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE 
  || (globalThis.location?.origin?.includes(':5173') ? 'http://localhost:4500' : globalThis.location?.origin) 
  || 'http://localhost:4500';
const URL_AUTH_YAYASAN = import.meta.env.VITE_AUTH_YAYASAN || '';

const CENTRAL_SPREADSHEET_URL = import.meta.env.VITE_SPREADSHEET_CENTRAL_URL || '';

const demoSession = {
  id: '',
  username: '',
  nama: '',
  urlApi: '',
};

const demoDapurs = [];

const demoRab = {
  targetPorsi: 0,
  batasAnggaran: 0,
};

const demoBom = [];

const initialStock = [];

function formatRp(value) {
  return `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function normalizeBom(items = []) {
  return items.map((item, index) => ({
    id: item.id || `${index + 1}`,
    // Support: hariMasak (Sheets aktual) | hari (alias lama)
    hariMasak: (item.hariMasak || item.hari || 'HARI INI').toUpperCase().trim(),
    // Tambah tanggalMasak dari Sheets
    tanggalMasak: item.tanggalMasak || '',
    namaBarang: item.namaBarang || item.nama || `Bahan ${index + 1}`,
    qtyRencana: toNumber(item.qtyRencana ?? item.qty_rencana ?? item.qty),
    satuan: item.satuan || '',
    // Support: hargaEstimasi (Sheets aktual) | hargaRab | harga_rab | harga_rencana
    hargaRab: toNumber(item.hargaRab ?? item.harga_rab ?? item.harga_rencana ?? item.hargaEstimasi ?? 0),
    // tipe: Sheets belum kirim field ini, default basah (beli di luar)
    tipe: item.tipe || 'basah',
    // targetPorsi & batasAnggaran bisa ada per-item atau dari root response
    targetPorsi: toNumber(item.targetPorsi ?? item.target_porsi ?? 0),
    batasAnggaran: toNumber(item.batasAnggaran ?? item.pagu_rab ?? item.batas_anggaran ?? 0),
  }));
}

function buildRowKey(item, index) {
  return `${index}_${item.namaBarang}`;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('sppg_token') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!sessionStorage.getItem('sppg_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [sessionDapur, setSessionDapur] = useState(() => {
    const saved = sessionStorage.getItem('sppg_session_dapur');
    return saved ? JSON.parse(saved) : demoSession;
  });
  const [availableDapurs, setAvailableDapurs] = useState(demoDapurs);
  const [selectedDapurId, setSelectedDapurId] = useState('');
  const [currentPage, setCurrentPage] = useState('beranda');
  const [selectedHari, setSelectedHari] = useState('SENIN');
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [backendStatus, setBackendStatus] = useState('Mengecek koneksi backend...');

  // Helper fetch dengan Authorization Header JWT Token
  const authFetch = async (url, options = {}) => {
    const savedToken = sessionStorage.getItem('sppg_token') || token;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (savedToken) {
      headers['Authorization'] = `Bearer ${savedToken}`;
    }
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      // Sesi kedaluwarsa atau tidak sah, logout otomatis
      sessionStorage.removeItem('sppg_token');
      sessionStorage.removeItem('sppg_session_dapur');
      setToken('');
      setIsLoggedIn(false);
      setSessionDapur(demoSession);
      alert('Sesi masuk Anda telah berakhir. Silakan login kembali.');
      throw new Error('Sesi kedaluwarsa.');
    }
    return res;
  };

  const [rabData, setRabData] = useState(demoRab);
  const [bomList, setBomList] = useState(demoBom);
  const activeBomList = useMemo(() => {
    return bomList.filter((item) => (item.hariMasak || '').toUpperCase() === selectedHari.toUpperCase());
  }, [bomList, selectedHari]);
  const activeRabData = useMemo(() => {
    if (activeBomList.length > 0 && activeBomList[0].targetPorsi) {
      return {
        targetPorsi: activeBomList[0].targetPorsi || 0,
        batasAnggaran: activeBomList[0].batasAnggaran || 0,
      };
    }
    return rabData;
  }, [activeBomList, rabData]);
  const [laporanInput, setLaporanInput] = useState({});
  const [fotoMasakan, setFotoMasakan] = useState(null);
  const [lastSubmit, setLastSubmit] = useState(null);

  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      console.log('beforeinstallprompt event triggered!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User choice outcome: ${outcome}`);
    setDeferredPrompt(null);
  };
  const [stock, setStock] = useState([]);

  const [newStockNama, setNewStockNama] = useState('');
  const [newStockQty, setNewStockQty] = useState('');
  const [newStockSatuan, setNewStockSatuan] = useState('Kg');
  const [newStockHarga, setNewStockHarga] = useState('');
  const [newStockFoto, setNewStockFoto] = useState(null);
  const [useOneNota, setUseOneNota] = useState(false);
  const [selectedRowsForBulkNota, setSelectedRowsForBulkNota] = useState([]);

  const [katalog, setKatalog] = useState([]);
  const [kulakanInput, setKulakanInput] = useState({});
  const [shippedOrders, setShippedOrders] = useState([]);

  const fetchKatalog = async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/koperasi/katalog`);
      const d = await res.json();
      if (d.success) setKatalog(d.data);
    } catch (e) {
      console.warn('Gagal fetch katalog:', e);
    }
  };

  const fetchShippedOrders = async () => {
    if (!sessionDapur.id) return;
    try {
      const res = await authFetch(`${API_BASE}/api/koperasi/order?idDapur=${sessionDapur.id}&status=DIKIRIM`);
      const d = await res.json();
      if (d.success) setShippedOrders(d.data);
    } catch (e) {
      console.warn('Gagal fetch shipped orders:', e);
    }
  };

  const fetchStock = async () => {
    if (!sessionDapur.id) return;
    try {
      const res = await authFetch(`${API_BASE}/api/gudang/stok?idDapur=${sessionDapur.id}`);
      const d = await res.json();
      if (d.success) setStock(d.data);
    } catch (e) {
      console.warn('Gagal fetch stok dari database server:', e);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchKatalog();
      fetchShippedOrders();
      fetchStock();
    }
  }, [isLoggedIn, currentPage, sessionDapur.id]);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((response) => response.json())
      .then((data) => setBackendStatus(data.success ? `Backend ${data.mode} - ${data.dapur || 30} dapur` : 'Backend belum siap'))
      .catch(() => setBackendStatus('Backend lokal belum aktif'));

    fetch(`${API_BASE}/api/dapur`)
      .then((response) => response.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data) && data.data.length) {
          setAvailableDapurs(data.data.map((item) => ({
            ...item,
            nama: item.nama,
            urlApi: item.urlApi || '',
          })));
          setSelectedDapurId(data.data[0].id);
        }
      })
      .catch(() => setAvailableDapurs(demoDapurs));
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !sessionDapur.urlApi) return;

    const syncSheets = async () => {
      setIsLoading(true);
      setSyncStatus('Mengambil data RAB dari Spreadsheet...');
      try {
        const response = await fetch(sessionDapur.urlApi);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // Support berbagai struktur response Google Sheets:
        // { dataRAB: [...] } | { items: [...] } | [...] (array langsung)
        const rawItems = data.dataRAB || data.items || (Array.isArray(data) ? data : []);
        const liveBom = normalizeBom(rawItems);

        // Ambil targetPorsi & batasAnggaran:
        // Prioritas 1: dari field root response
        // Prioritas 2: dari item pertama dalam array (jika ada)
        // Prioritas 3: 0
        const firstItem = rawItems[0] || {};
        const targetPorsi = toNumber(
          data.targetPorsi ?? data.total_pm ?? data.target_porsi
          ?? firstItem.targetPorsi ?? firstItem.target_porsi ?? 0
        );
        const batasAnggaran = toNumber(
          data.batasAnggaran ?? data.pagu_rab ?? data.batas_anggaran
          ?? firstItem.batasAnggaran ?? firstItem.pagu_rab ?? 0
        );

        setRabData({ targetPorsi, batasAnggaran });
        setBomList(liveBom.length ? liveBom : []);
        setSyncStatus(
          liveBom.length
            ? `✓ ${liveBom.length} bahan RAB berhasil dimuat dari Spreadsheet.`
            : 'Spreadsheet terhubung tapi belum ada data RAB.'
        );
      } catch (error) {
        setBomList([]);
        setSyncStatus(`Gagal memuat RAB dari Spreadsheet: ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    syncSheets();
  }, [isLoggedIn, sessionDapur.urlApi]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');

    if (!username.trim() || !password) {
      setLoginError('Username dan password wajib diisi.');
      return;
    }

    setIsLoading(true);

    const applyDapurSession = (selected, tokenVal, message) => {
      const finalUrlApi = selected.urlApi || (CENTRAL_SPREADSHEET_URL ? `${CENTRAL_SPREADSHEET_URL}?dapur=${selected.username || selected.id}` : '');
      const finalSession = {
        id: selected.id,
        username: selected.username || '',
        nama: selected.nama,
        urlApi: finalUrlApi,
      };
      
      sessionStorage.setItem('sppg_session_dapur', JSON.stringify(finalSession));
      if (tokenVal) {
        sessionStorage.setItem('sppg_token', tokenVal);
        setToken(tokenVal);
      }
      
      setSessionDapur(finalSession);
      setRabData({
        targetPorsi: selected.targetPorsi || demoRab.targetPorsi,
        batasAnggaran: selected.batasAnggaran || demoRab.batasAnggaran,
      });
      setBomList(demoBom);
      setIsLoggedIn(true);
      setSyncStatus(message);
    };

    try {
      // Coba login ke backend lokal terlebih dahulu
      const loginResponse = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const loginJson = await loginResponse.json();
      if (!loginResponse.ok || !loginJson.success) {
        throw new Error(loginJson.message || 'Login gagal.');
      }
      applyDapurSession(loginJson.data, loginJson.token, `Selamat datang, ${loginJson.data.nama}.`);
    } catch (localError) {
      // Jika backend offline, coba fallback ke Google Sheets Auth
      if (URL_AUTH_YAYASAN) {
        try {
          const response = await fetch(URL_AUTH_YAYASAN);
          if (!response.ok) throw new Error(`Server auth tidak dapat dihubungi (HTTP ${response.status}).`);
          const dataMaster = await response.json();
          const akunDitemukan = (dataMaster.payloadAkun || []).find(
            (akun) => akun.username?.toLowerCase().trim() === username.toLowerCase().trim()
              && akun.password === password,
          );
          if (!akunDitemukan) throw new Error('Username atau password salah.');
          setSessionDapur({
            id: akunDitemukan.idDapur,
            username: akunDitemukan.username || '',
            nama: akunDitemukan.namaDapur,
            urlApi: akunDitemukan.urlApiDapur,
          });
          setIsLoggedIn(true);
          setSyncStatus(`Selamat datang, ${akunDitemukan.namaDapur}.`);
        } catch (sheetError) {
          setLoginError(sheetError.message);
        }
      } else {
        setLoginError(localError.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const updateInput = (rowKey, field, value) => {
    setLaporanInput((previous) => ({
      ...previous,
      [rowKey]: {
        sumber: 'KOPERASI',
        qtyRiil: '',
        hargaSatuanRiil: '',
        totalRiil: '',
        fotoNota: null,
        ...previous[rowKey],
        [field]: value,
      },
    }));
  };

  const handleFotoNota = async (rowKey, file) => {
    if (!file) return;
    const encoded = await fileToDataUrl(file);
    if (useOneNota) {
      const nextInput = { ...laporanInput };
      activeBomList.forEach((item, index) => {
        const key = buildRowKey(item, index);
        nextInput[key] = {
          qtyRiil: item.qtyRencana,
          hargaSatuanRiil: item.hargaRab,
          totalRiil: item.qtyRencana * item.hargaRab,
          sumber: 'KOPERASI',
          ...nextInput[key],
          fotoNota: encoded
        };
      });
      setLaporanInput(nextInput);
    } else {
      updateInput(rowKey, 'fotoNota', encoded);
    }
  };

  const handleToggleUseOneNota = (checked) => {
    setUseOneNota(checked);
    if (checked) {
      let firstPhoto = null;
      for (const key of Object.keys(laporanInput)) {
        if (laporanInput[key]?.fotoNota) {
          firstPhoto = laporanInput[key].fotoNota;
          break;
        }
      }
      if (firstPhoto) {
        const nextInput = { ...laporanInput };
        activeBomList.forEach((item, index) => {
          const key = buildRowKey(item, index);
          nextInput[key] = {
            qtyRiil: item.qtyRencana,
            hargaSatuanRiil: item.hargaRab,
            totalRiil: item.qtyRencana * item.hargaRab,
            sumber: 'KOPERASI',
            ...nextInput[key],
            fotoNota: firstPhoto
          };
        });
        setLaporanInput(nextInput);
      }
    }
  };

  const handleToggleSelectRow = (key) => {
    setSelectedRowsForBulkNota((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleBulkFotoNota = async (file) => {
    if (!file || selectedRowsForBulkNota.length === 0) return;
    const encoded = await fileToDataUrl(file);

    const nextInput = { ...laporanInput };
    selectedRowsForBulkNota.forEach((key) => {
      const parts = key.split('_');
      const idx = Number(parts[0]);
      const item = activeBomList[idx] || {};

      nextInput[key] = {
        qtyRiil: item.qtyRencana || '',
        hargaSatuanRiil: item.hargaRab || '',
        totalRiil: (item.qtyRencana || 0) * (item.hargaRab || 0),
        sumber: 'KOPERASI',
        ...nextInput[key],
        fotoNota: encoded
      };
    });

    setLaporanInput(nextInput);
    setSelectedRowsForBulkNota([]);
    alert(`Berhasil menerapkan foto nota ke ${selectedRowsForBulkNota.length} bahan terpilih.`);
  };

  const handleFotoMasakan = async (file) => {
    if (!file) return;
    setFotoMasakan(await fileToDataUrl(file));
  };

  const handleGudangFotoNota = async (file) => {
    if (!file) return;
    setNewStockFoto(await fileToDataUrl(file));
  };

  const handleAddStock = async (e) => {
    e.preventDefault();
    if (!newStockNama || !newStockQty || !newStockHarga) {
      alert('Mohon lengkapi Nama Bahan, Jumlah Qty, dan Harga Satuan.');
      return;
    }

    const qtyNum = Number(newStockQty) || 0;
    const priceUnit = Number(newStockHarga) || 0;
    const namaNormal = newStockNama.trim();

    setIsLoading(true);
    try {
      // 1. Kirim ke Server Lokal (untuk Dashboard Yayasan & lightbox foto)
      const localPayload = {
        idDapur: sessionDapur.id || 'D-01',
        namaDapur: sessionDapur.nama || 'SPPG Dapur 01',
        tanggalInput: new Date().toISOString().split('T')[0],
        targetPorsi: 0,
        batasAnggaran: 0,
        items: [
          {
            namaBarang: namaNormal,
            qty: qtyNum,
            satuan: newStockSatuan,
            hargaRab: priceUnit,
            totalRab: qtyNum * priceUnit,
            totalRiil: qtyNum * priceUnit,
            sumber: 'GUDANG_MANDIRI',
            fotoNota: newStockFoto,
            catatan: 'Update Stok Mandiri Dapur'
          }
        ]
      };

      const backendRes = await authFetch(`${API_BASE}/api/laporan`, {
        method: 'POST',
        body: JSON.stringify(localPayload)
      });
      if (!backendRes.ok) throw new Error('Gagal mencatat transaksi di server lokal');

      // 2. Kirim ke Google Sheets (untuk audit rekap keuangan permanen)
      const postUrl = CENTRAL_SPREADSHEET_URL || (sessionDapur.urlApi ? sessionDapur.urlApi.split('?')[0] : '');
      if (postUrl) {
        const sheetsPayload = {
          idDapur: sessionDapur.username || sessionDapur.id || 'dapur01',
          lokasiBeli: 'GUDANG_MANDIRI',
          namaBarang: namaNormal,
          qty: qtyNum,
          satuan: newStockSatuan,
          harga: priceUnit,
          tanggalInput: new Date().toISOString().split('T')[0]
        };
        await fetch(postUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sheetsPayload),
        });
      }

      // 3. Simpan perubahan stok ke database server (/api/gudang/stok)
      const existingItem = stock.find(item => item.namaBarang.toLowerCase() === namaNormal.toLowerCase());
      const oldQty = existingItem ? existingItem.qty : 0;
      const oldPrice = existingItem ? existingItem.hargaSatuan : 0;
      const totalQty = oldQty + qtyNum;
      const avgPrice = totalQty > 0 ? ((oldQty * oldPrice) + (qtyNum * priceUnit)) / totalQty : priceUnit;

      const dbStokRes = await authFetch(`${API_BASE}/api/gudang/stok`, {
        method: 'POST',
        body: JSON.stringify({
          idDapur: sessionDapur.id,
          items: [{
            namaBarang: namaNormal,
            qty: totalQty,
            satuan: newStockSatuan,
            hargaSatuan: Math.round(avgPrice),
            fotoNota: newStockFoto // sertakan lampiran foto nota jika ada
          }]
        })
      });
      if (!dbStokRes.ok) throw new Error('Gagal memperbarui stok di database server');

      await fetchStock(); // Refresh list stok dari server

      setNewStockNama('');
      setNewStockQty('');
      setNewStockHarga('');
      setNewStockFoto(null);
      alert('Stok mandiri dapur berhasil diupdate! Bukti nota & laporan berhasil terkirim ke Yayasan dan Sheets.');
    } catch (err) {
      alert(`Gagal menyimpan perubahan stok: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitKulakan = async (e) => {
    e.preventDefault();
    const itemsToOrder = Object.entries(kulakanInput)
      .map(([namaBarang, qty]) => {
        const product = katalog.find(p => p.namaBarang === namaBarang);
        return {
          namaBarang,
          qty: Number(qty) || 0,
          satuan: product ? product.satuan : 'Pcs',
          hargaSatuan: product ? product.hargaSatuan : 0
        };
      })
      .filter(item => item.qty > 0);

    if (itemsToOrder.length === 0) {
      alert('Mohon pilih kuantitas minimal 1 barang untuk dipesan.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/koperasi/order`, {
        method: 'POST',
        body: JSON.stringify({
          idDapur: sessionDapur.id,
          namaDapur: sessionDapur.nama,
          items: itemsToOrder
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal mengirim order kulakan.');

      setKulakanInput({});
      alert('Pesanan kulakan berhasil dikirim ke Koperasi! Silakan pantau pengiriman di tab Gudang.');
      setCurrentPage('gudang');
    } catch (err) {
      alert(`Gagal mengirim pesanan: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTerimaOrder = async (order) => {
    if (!confirm(`Konfirmasi penerimaan pesanan #${order.id}?`)) return;

    setIsLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/koperasi/order/${order.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'SELESAI' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal konfirmasi penerimaan.');

      // Hitung stok baru dengan average price
      const updatedItems = [];
      order.items.forEach((orderedItem) => {
        const existingIdx = stock.findIndex(
          (item) => item.namaBarang.toLowerCase() === orderedItem.namaBarang.toLowerCase()
        );
        if (existingIdx > -1) {
          const oldItem = stock[existingIdx];
          const totalQty = oldItem.qty + orderedItem.qty;
          const avgPrice = totalQty > 0
            ? (oldItem.qty * oldItem.hargaSatuan + orderedItem.qty * orderedItem.hargaSatuan) / totalQty
            : orderedItem.hargaSatuan;

          updatedItems.push({
            namaBarang: oldItem.namaBarang,
            qty: totalQty,
            satuan: orderedItem.satuan || oldItem.satuan,
            hargaSatuan: Math.round(avgPrice)
          });
        } else {
          updatedItems.push({
            namaBarang: orderedItem.namaBarang,
            qty: orderedItem.qty,
            satuan: orderedItem.satuan,
            hargaSatuan: orderedItem.hargaSatuan
          });
        }
      });

      // Simpan perubahan stok ke database server (/api/gudang/stok)
      const dbStokRes = await authFetch(`${API_BASE}/api/gudang/stok`, {
        method: 'POST',
        body: JSON.stringify({
          idDapur: sessionDapur.id,
          items: updatedItems
        })
      });
      if (!dbStokRes.ok) throw new Error('Gagal memperbarui stok di database server');

      await fetchStock(); // Muat ulang stok dari server

      alert('Barang berhasil diterima dan langsung dimasukkan ke Stok Gudang Dapur!');
      fetchShippedOrders();
    } catch (err) {
      alert(`Gagal menerima barang: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fillRabAsReal = () => {
    const nextInput = { ...laporanInput };
    activeBomList.forEach((item, index) => {
      const rowKey = buildRowKey(item, index);
      nextInput[rowKey] = {
        sumber: item.tipe === 'stok' ? 'AMBIL_GUDANG' : 'KOPERASI',
        qtyRiil: item.qtyRencana,
        hargaSatuanRiil: item.hargaRab,
        totalRiil: item.qtyRencana * item.hargaRab,
        fotoNota: laporanInput[rowKey]?.fotoNota || null,
      };
    });
    setLaporanInput(nextInput);
  };

  const audit = useMemo(() => {
    const rows = activeBomList.map((item, index) => {
      const rowKey = buildRowKey(item, index);
      const input = laporanInput[rowKey] || {};
      const qtyRiil = toNumber(input.qtyRiil || item.qtyRencana);
      const hargaSatuanRiil = toNumber(input.hargaSatuanRiil);
      const totalRab = item.qtyRencana * item.hargaRab;
      const totalRiil = toNumber(input.totalRiil) || qtyRiil * hargaSatuanRiil;
      const selisih = totalRiil - totalRab;
      const deviasiPersen = totalRab > 0 ? (selisih / totalRab) * 100 : 0;

      const isAmbilGudang = (input.sumber || 'KOPERASI') === 'AMBIL_GUDANG';

      return {
        ...item,
        rowKey,
        sumber: input.sumber || 'KOPERASI',
        qtyRiil,
        hargaSatuanRiil,
        totalRab,
        totalRiil,
        fotoNota: input.fotoNota,
        selisih,
        deviasiPersen,
        flagged: totalRiil <= 0 || (!isAmbilGudang && !input.fotoNota) || deviasiPersen > 10,
      };
    });

    const totalRab = rows.reduce((sum, row) => sum + row.totalRab, 0);
    const totalRiil = rows.reduce((sum, row) => sum + row.totalRiil, 0);
    const totalKoperasi = rows
      .filter((row) => row.sumber === 'KOPERASI')
      .reduce((sum, row) => sum + row.totalRiil, 0);
    const totalMarkup = rows
      .filter((row) => row.selisih > 0)
      .reduce((sum, row) => sum + row.selisih, 0);

    return {
      rows,
      totalRab,
      totalRiil,
      totalKoperasi,
      totalMarkup,
      persenKoperasi: totalRiil > 0 ? (totalKoperasi / totalRiil) * 100 : 0,
      targetHpp: activeRabData.targetPorsi > 0 ? activeRabData.batasAnggaran / activeRabData.targetPorsi : 0,
      riilHpp: activeRabData.targetPorsi > 0 ? totalRiil / activeRabData.targetPorsi : 0,
      flaggedRows: rows.filter((row) => row.flagged),
    };
  }, [activeBomList, laporanInput, activeRabData]);

  const submitLaporan = async () => {
    // 1. Validasi kecukupan stok gudang lokal
    const insufficientStock = audit.rows.find((row) => {
      if (row.sumber === 'AMBIL_GUDANG') {
        const stockItem = stock.find((s) => s.namaBarang.toLowerCase() === row.namaBarang.toLowerCase());
        if (!stockItem || stockItem.qty < row.qtyRiil) {
          return true;
        }
      }
      return false;
    });

    if (insufficientStock) {
      const stockItem = stock.find((s) => s.namaBarang.toLowerCase() === insufficientStock.namaBarang.toLowerCase());
      const qtyTersedia = stockItem ? stockItem.qty : 0;
      alert(`Stok gudang tidak mencukupi untuk "${insufficientStock.namaBarang}". Tersedia: ${qtyTersedia} ${insufficientStock.satuan}, Dibutuhkan: ${insufficientStock.qtyRiil} ${insufficientStock.satuan}. Silakan tambah stok terlebih dahulu di tab Gudang.`);
      setCurrentPage('gudang');
      return;
    }

    // 2. Validasi input riil & foto nota (Bahan dari gudang dibebaskan dari foto nota)
    const missing = audit.rows.find((row) => row.totalRiil <= 0 || (row.sumber !== 'AMBIL_GUDANG' && !row.fotoNota));
    if (missing) {
      alert(`Lengkapi total riil dan foto nota untuk ${missing.namaBarang}. (Bahan dari gudang mandiri tidak memerlukan foto nota).`);
      setCurrentPage('laporan');
      return;
    }

    if (!fotoMasakan) {
      alert('Foto masakan matang wajib diunggah sebelum laporan dikirim.');
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        idDapur: sessionDapur.id,
        namaDapur: sessionDapur.nama,
        targetPorsi: activeRabData.targetPorsi,
        batasAnggaran: activeRabData.batasAnggaran,
        fotoMasakan,
        items: audit.rows.map((row) => ({
          id: row.id,
          namaBarang: row.namaBarang,
          qty: row.qtyRiil,
          satuan: row.satuan,
          hargaRab: row.hargaRab,
          totalRab: row.totalRab,
          totalRiil: row.totalRiil,
          sumber: row.sumber,
          fotoNota: row.fotoNota,
        })),
      };

      const response = await authFetch(`${API_BASE}/api/laporan`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Gagal mengirim laporan.');

      // Sinkronisasi ke Google Sheets Spreadsheet
      const postUrl = CENTRAL_SPREADSHEET_URL || (sessionDapur.urlApi ? sessionDapur.urlApi.split('?')[0] : '');
      if (postUrl) {
        try {
          const promises = audit.rows.map((row) => {
            const rowPayload = {
              idDapur: sessionDapur.username || sessionDapur.id || 'dapur01',
              jenisInput: `REALISASI_${row.hariMasak || 'HARI_INI'}`,
              tanggalInput: new Date().toISOString().split('T')[0],
              namaBarang: row.namaBarang,
              qty: row.qtyRiil,
              satuan: row.satuan,
              harga: row.hargaSatuanRiil,
              status: "Realisasi",
              linkNota: row.fotoNota ? "Ada Foto" : "-"
            };
            return fetch(postUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(rowPayload),
            });
          });
          await Promise.all(promises);
        } catch (sheetError) {
          console.warn('Gagal sinkron ke Google Sheets:', sheetError);
        }
      }

      setLastSubmit(data.data);
      // Ambil data stok terbaru dari server (stok sudah berkurang otomatis di backend)
      await fetchStock();
      alert('Laporan berhasil dikirim dan diaudit backend.');
      setCurrentPage('review');
    } catch (error) {
      alert(`Gagal kirim laporan: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden selection:bg-emerald-500 selection:text-slate-950">
        {/* Background Radial Glow Effects */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-teal-500/10 blur-[120px] pointer-events-none"></div>
        
        <div className="w-full max-w-sm z-10 animate-fade-in">
          {/* Logo / Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner shadow-emerald-500/10 mb-4">
              <span className="text-3xl filter drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">🍽️</span>
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.2)]">
              SPPG Control Suite
            </p>
            <h1 className="text-2xl font-black text-white mt-1.5 tracking-tight">Portal PIC Dapur</h1>
            <p className="text-xs text-slate-400 mt-2">Masuk menggunakan akun yang diberikan koordinator.</p>
          </div>

          {/* Glassmorphism Card */}
          <div className="bg-slate-900/60 backdrop-blur-xl rounded-3xl border border-white/5 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.4)] relative">
            <div className="absolute inset-0 rounded-3xl border border-emerald-500/10 pointer-events-none"></div>
            
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 ml-1">
                  Username Dapur
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setLoginError(''); }}
                  className="w-full bg-slate-950/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all placeholder:text-slate-700"
                  placeholder="contoh: dapur01"
                  autoComplete="username"
                  autoCapitalize="none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 ml-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setLoginError(''); }}
                  className="w-full bg-slate-950/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all placeholder:text-slate-700"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {/* Error message */}
              {loginError && (
                <div className="bg-rose-950/30 border border-rose-900/30 rounded-xl px-4 py-3 flex items-start gap-2 animate-pulse">
                  <span className="text-rose-400 mt-0.5 text-xs">⚠️</span>
                  <p className="text-[11px] text-rose-400 font-semibold">{loginError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-3.5 text-xs font-bold uppercase tracking-widest text-white transition-all duration-250 shadow-lg shadow-emerald-950/20 hover:shadow-emerald-500/20 mt-2"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Memverifikasi...
                  </span>
                ) : 'Masuk Sistem'}
              </button>
            </form>

            {/* Status backend */}
            <div className="mt-5 pt-4 border-t border-white/5 flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                backendStatus.includes('aktif') || (backendStatus.includes('Backend') && !backendStatus.includes('belum'))
                  ? 'bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse'
                  : 'bg-slate-600'
              }`} />
              <p className="text-[10px] text-slate-500 truncate font-medium">{backendStatus}</p>
            </div>
          </div>

          {/* PWA Install */}
          {deferredPrompt && (
            <div className="mt-4">
              <button
                onClick={handleInstallPWA}
                className="w-full bg-slate-900/40 backdrop-blur-md hover:bg-slate-900/60 text-emerald-400 border border-white/5 rounded-2xl py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-200"
              >
                <span>📥</span> Instal Aplikasi di HP
              </button>
            </div>
          )}

          {/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream && !(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) && (
            <div className="mt-4 p-3 bg-emerald-950/40 border border-emerald-900/50 rounded-2xl text-[10px] text-slate-400 text-center">
              💡 Instal di iPhone: tap <strong className="text-white">Share</strong> → <strong className="text-emerald-400">Add to Home Screen</strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-200 flex justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-slate-50 sm:rounded-[2rem] sm:border-8 sm:border-slate-900 shadow-2xl min-h-screen sm:min-h-[760px] sm:max-h-[760px] flex flex-col overflow-hidden">
        <header className="bg-emerald-700 text-white px-5 pt-8 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">{sessionDapur.id}</p>
              <h1 className="text-lg font-black leading-tight">{sessionDapur.nama}</h1>
              <p className="text-[10px] text-emerald-100 mt-1">{syncStatus}</p>
            </div>
            <button
              onClick={() => {
                sessionStorage.removeItem('sppg_token');
                sessionStorage.removeItem('sppg_session_dapur');
                setToken('');
                setIsLoggedIn(false);
                setSessionDapur(demoSession);
              }}
              className="bg-emerald-950/40 rounded-lg px-3 py-2 text-[10px] font-bold"
            >
              Keluar
            </button>
          </div>
        </header>

        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
          {['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT'].map((day) => {
            const dayItems = bomList.filter(i => (i.hariMasak || '').toUpperCase() === day);
            return (
              <button
                key={day}
                onClick={() => setSelectedHari(day)}
                className={`flex-shrink-0 rounded-xl px-4 py-2 text-[10px] font-black tracking-wider uppercase transition-all ${
                  selectedHari === day ? 'bg-emerald-700 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span>{day}</span>
                {dayItems.length > 0 && (
                  <span className={`block text-[8px] font-bold mt-0.5 ${
                    selectedHari === day ? 'text-emerald-200' : 'text-slate-400'
                  }`}>{dayItems[0].tanggalMasak || `${dayItems.length} bhn`}</span>
                )}
              </button>
            );
          })}
        </div>

        <main className="flex-1 overflow-y-auto pb-24">
          {currentPage === 'beranda' && (
            <section className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Target PM" value={`${Number(activeRabData.targetPorsi).toLocaleString('id-ID')} Anak`} />
                <MetricCard label="Batas RAB" value={formatRp(activeRabData.batasAnggaran)} tone="amber" />
                <MetricCard label="HPP Target" value={formatRp(audit.targetHpp)} />
                <MetricCard label="Backend" value={backendStatus} small />
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-black text-slate-800">Daftar RAB/BOM</h2>
                    {activeBomList.length > 0 && activeBomList[0].tanggalMasak && (
                      <p className="text-[10px] text-slate-500 mt-0.5">📅 {activeBomList[0].tanggalMasak}</p>
                    )}
                  </div>
                  <button onClick={fillRabAsReal} className="text-[10px] font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg">
                    Isi dari RAB
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {bomList.length === 0 ? (
                    <div className="p-6 text-center">
                      <p className="text-xs text-slate-400">{syncStatus || 'Data RAB belum dimuat.'}</p>
                      {sessionDapur.urlApi && (
                        <button
                          onClick={() => { setIsLoggedIn(false); setTimeout(() => setIsLoggedIn(true), 50); }}
                          className="mt-3 text-[10px] font-bold text-emerald-600 underline"
                        >
                          Coba sync ulang
                        </button>
                      )}
                    </div>
                  ) : activeBomList.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Tidak ada bahan RAB untuk hari <strong>{selectedHari}</strong>.
                    </div>
                  ) : (
                    <>
                      {activeBomList.map((item, index) => (
                        <div key={buildRowKey(item, index)} className="px-4 py-3 flex justify-between items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-black text-slate-800 truncate">{item.namaBarang}</p>
                            <p className="text-[10px] text-slate-500">{item.qtyRencana} {item.satuan} × {formatRp(item.hargaRab)}</p>
                          </div>
                          <p className="text-xs font-black text-emerald-700 flex-shrink-0">{formatRp(item.qtyRencana * item.hargaRab)}</p>
                        </div>
                      ))}
                      {/* Total RAB hari ini */}
                      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total RAB {selectedHari}</p>
                        <p className="text-sm font-black text-slate-800">
                          {formatRp(activeBomList.reduce((sum, i) => sum + i.qtyRencana * i.hargaRab, 0))}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {currentPage === 'laporan' && (
            <section className="p-4 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <h2 className="text-sm font-black text-slate-800">Input Realisasi Per Bahan</h2>
                <p className="text-[10px] text-slate-500 mt-1">Setiap baris wajib punya nominal riil dan foto nota/bukti.</p>
              </div>

              {activeBomList.length > 0 && selectedRowsForBulkNota.length > 0 && (
                <div className="bg-amber-600 text-white rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs font-black">Beli Bersama (1 Supplier)</p>
                      <p className="text-[10px] text-amber-100 mt-0.5">Terpilih {selectedRowsForBulkNota.length} bahan. Upload 1 foto nota untuk semuanya.</p>
                    </div>
                    <button 
                      onClick={() => setSelectedRowsForBulkNota([])}
                      className="text-[10px] font-bold bg-amber-700 px-2 py-1 rounded-md text-white hover:bg-amber-800"
                    >
                      Batal Pilih
                    </button>
                  </div>
                  <div className="bg-amber-700 rounded-xl p-2.5">
                    <label className="block">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-amber-200 mb-1">Ambil Foto Nota (Kamera)</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleBulkFotoNota(e.target.files[0])}
                        className="w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-white file:text-amber-800 file:px-3 file:py-1.5"
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeBomList.length > 0 && selectedRowsForBulkNota.length === 0 && (
                <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
                  <div className="pr-4">
                    <p className="text-xs font-black text-emerald-400">Satu Nota untuk Semua Item</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Aktifkan jika belanja beras, ayam, dll. dari 1 supplier dengan 1 kertas kuitansi/nota saja.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={useOneNota}
                    onChange={(e) => handleToggleUseOneNota(e.target.checked)}
                    className="w-6 h-6 rounded-lg accent-emerald-500 bg-slate-800 border-slate-700 outline-none cursor-pointer"
                  />
                </div>
              )}

              {activeBomList.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
                  Tidak ada bahan masakan untuk diinput pada hari {selectedHari}.
                </div>
              ) : (
                activeBomList.map((item, index) => {
                  const rowKey = buildRowKey(item, index);
                  const input = laporanInput[rowKey] || {};
                  const totalRab = item.qtyRencana * item.hargaRab;
                  const totalRiil = toNumber(input.totalRiil) || toNumber(input.qtyRiil) * toNumber(input.hargaSatuanRiil);
                  const deviasi = totalRab > 0 ? ((totalRiil - totalRab) / totalRab) * 100 : 0;

                  return (
                    <div key={rowKey} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
                      <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedRowsForBulkNota.includes(rowKey)}
                            onChange={() => handleToggleSelectRow(rowKey)}
                            className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 mt-1 cursor-pointer"
                          />
                          <div>
                            <p className="text-[10px] font-bold text-slate-400">{item.hariMasak} - {item.tipe}</p>
                            <h3 className="text-sm font-black text-slate-800">{item.namaBarang}</h3>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-slate-400 font-bold">RAB</p>
                          <p className="text-xs font-black text-slate-700">{formatRp(totalRab)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="block text-[10px] font-bold text-slate-500 mb-1">Sumber Bahan</span>
                          <select
                            value={input.sumber || 'KOPERASI'}
                            onChange={(event) => updateInput(rowKey, 'sumber', event.target.value)}
                            className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none"
                          >
                            <option value="KOPERASI">Koperasi</option>
                            <option value="SUPPLIER_LUAR">Supplier Luar</option>
                            <option value="AMBIL_GUDANG">Ambil Gudang</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="block text-[10px] font-bold text-slate-500 mb-1">Qty Riil ({item.satuan})</span>
                          <input
                            type="number"
                            step="any"
                            value={input.qtyRiil ?? ''}
                            onChange={(event) => updateInput(rowKey, 'qtyRiil', event.target.value)}
                            placeholder={item.qtyRencana}
                            className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="block text-[10px] font-bold text-slate-500 mb-1">Harga Satuan Riil</span>
                          <input
                            type="number"
                            value={input.hargaSatuanRiil ?? ''}
                            onChange={(event) => updateInput(rowKey, 'hargaSatuanRiil', event.target.value)}
                            placeholder={item.hargaRab}
                            className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none"
                          />
                        </label>

                        <div className="block">
                          <span className="block text-[10px] font-bold text-slate-500 mb-1">Total Riil</span>
                          <p className="text-xs font-black text-slate-800 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                            {formatRp(totalRiil)}
                          </p>
                        </div>
                      </div>

                      {input.sumber !== 'AMBIL_GUDANG' ? (
                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                          <label className="block text-[10px] font-bold text-slate-500 mb-2">Foto Nota / Bukti Belanja</label>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(event) => handleFotoNota(rowKey, event.target.files[0])}
                            className="w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:px-3 file:py-2"
                          />
                          <p className={`text-[10px] font-bold mt-1 ${input.fotoNota ? 'text-emerald-600' : 'text-red-500'}`}>
                            {input.fotoNota ? 'Foto bukti sudah tersimpan.' : 'Belum ada foto bukti.'}
                          </p>
                        </div>
                      ) : (
                        <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl p-3 text-[10px] font-bold">
                          ✓ Diambil dari Gudang Mandiri Dapur. Tidak memerlukan upload foto nota belanja.
                        </div>
                      )}

                      <p className={`text-[10px] font-bold rounded-lg p-2 ${deviasi > 10 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500'}`}>
                        Deviasi terhadap RAB: {Number.isFinite(deviasi) ? deviasi.toFixed(1) : '0.0'}%
                      </p>
                    </div>
                  );
                })
              )}
            </section>
          )}

          {currentPage === 'review' && (
            <section className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Total RAB" value={formatRp(audit.totalRab)} />
                <MetricCard label="Total Riil" value={formatRp(audit.totalRiil)} tone={audit.totalRiil > audit.totalRab ? 'red' : 'emerald'} />
                <MetricCard label="HPP Target" value={formatRp(audit.targetHpp)} />
                <MetricCard label="HPP Riil" value={formatRp(audit.riilHpp)} tone={audit.riilHpp > audit.targetHpp ? 'red' : 'emerald'} />
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2">Foto Masakan Matang</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => handleFotoMasakan(event.target.files[0])}
                  className="w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-emerald-700 file:text-white file:px-3 file:py-2"
                />
                {fotoMasakan && <p className="text-[10px] text-emerald-600 font-bold mt-2">Foto masakan siap dikirim.</p>}
              </div>

              {lastSubmit && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                  <p className="text-xs font-black text-emerald-800">Laporan terakhir: {lastSubmit.id}</p>
                  <p className="text-[10px] text-emerald-700 mt-1">Sudah masuk backend dan dapat dibaca dashboard yayasan.</p>
                </div>
              )}

              <button
                onClick={submitLaporan}
                disabled={isLoading}
                className="w-full bg-emerald-700 disabled:opacity-60 text-white rounded-2xl py-4 text-xs font-black uppercase tracking-widest shadow-sm"
              >
                {isLoading ? 'Mengirim...' : 'Kirim Laporan ke Yayasan'}
              </button>
            </section>
          )}

          {currentPage === 'gudang' && (
            <section className="p-4 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <h2 className="text-sm font-black text-slate-800">Stok Gudang Dapur</h2>
                <p className="text-[10px] text-slate-500 mt-1">Stok berkurang otomatis setelah laporan dikirim untuk item sumber gudang.</p>
              </div>

              {/* Pesanan Koperasi dalam Pengiriman */}
              {shippedOrders.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Pengiriman Koperasi (Belum Diterima)</h3>
                  {shippedOrders.map((order) => (
                    <div key={order.id} className="bg-blue-600 text-white rounded-2xl p-4 shadow-sm space-y-3 border border-blue-500">
                      <div className="flex justify-between items-center border-b border-blue-500 pb-2">
                        <div>
                          <p className="text-[9px] font-bold text-blue-200">KULAKAN KOPERASI</p>
                          <p className="text-xs font-black">ORDER: #{order.id}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-black bg-white text-blue-700">DIKIRIM</span>
                      </div>
                      <div className="space-y-1 text-[11px] text-blue-100">
                        {order.items.map((i) => (
                          <div key={i.namaBarang} className="flex justify-between">
                            <span>{i.namaBarang}</span>
                            <span className="font-bold">{i.qty} {i.satuan}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleTerimaOrder(order)}
                        disabled={isLoading}
                        className="w-full bg-white text-blue-700 hover:bg-slate-100 text-xs font-black uppercase tracking-wider rounded-xl py-2 shadow-sm transition-all"
                      >
                        {isLoading ? 'Memproses...' : 'Terima & Masukkan Gudang'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Form Input Belanja Gudang */}
              <form onSubmit={handleAddStock} className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400">Update Stok Mandiri Dapur</h3>
                
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Nama Bahan</span>
                    <input
                      type="text"
                      value={newStockNama}
                      onChange={(e) => setNewStockNama(e.target.value)}
                      placeholder="Garam / Merica / Lada"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-white"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Satuan</span>
                    <select
                      value={newStockSatuan}
                      onChange={(e) => setNewStockSatuan(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-white"
                    >
                      <option value="Kg">Kg</option>
                      <option value="Pcs">Pcs</option>
                      <option value="Bks">Bks (Bungkus)</option>
                      <option value="Botol">Botol</option>
                      <option value="Dus">Dus</option>
                      <option value="Liter">Liter</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Jumlah (Qty)</span>
                    <input
                      type="number"
                      step="any"
                      value={newStockQty}
                      onChange={(e) => setNewStockQty(e.target.value)}
                      placeholder="e.g. 5"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-white"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Harga Satuan (Rp)</span>
                    <input
                      type="number"
                      value={newStockHarga}
                      onChange={(e) => setNewStockHarga(e.target.value)}
                      placeholder="e.g. 3000"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-white"
                    />
                  </label>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Foto Nota / Bukti (Kamera)</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleGudangFotoNota(e.target.files[0])}
                      className="w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:text-white file:px-3 file:py-1.5"
                    />
                  </label>
                  {newStockFoto && <p className="text-[10px] text-emerald-400 font-bold mt-1.5">Foto bukti nota terlampir.</p>}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-black uppercase tracking-wider rounded-lg py-2.5 mt-2"
                >
                  {isLoading ? 'Menyimpan...' : 'Tambah Ke Stok Gudang'}
                </button>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                {stock.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Belum ada barang di stok gudang. Gunakan form di atas untuk menambah stok baru.
                  </div>
                ) : (
                  stock.map((item) => (
                    <div key={item.namaBarang} className="p-3 flex justify-between">
                      <div>
                        <p className="text-xs font-black text-slate-800">{item.namaBarang}</p>
                        <p className="text-[10px] text-slate-500">{formatRp(item.hargaSatuan)} / {item.satuan}</p>
                      </div>
                      <p className="text-xs font-black text-emerald-700">{item.qty.toLocaleString('id-ID')} {item.satuan}</p>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {currentPage === 'kulakan' && (
            <section className="p-4 space-y-4 animate-fade-in">
              <div className="bg-emerald-700 text-white rounded-2xl p-4 shadow-sm relative overflow-hidden">
                <div className="absolute right-[-10px] bottom-[-20px] text-7xl opacity-10 pointer-events-none">🏪</div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-100">Kulakan Koperasi Pusat</h2>
                <p className="text-[10px] text-emerald-200/90 mt-1 leading-relaxed">
                  Pesan bahan baku curah / grosir berkualitas langsung dari Koperasi Pusat untuk mengisi kembali stok dapur Anda.
                </p>
              </div>

              {katalog.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400 shadow-sm">
                  Tidak ada produk yang tersedia di katalog saat ini.
                </div>
              ) : (
                <form onSubmit={handleSubmitKulakan} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    {katalog.map((item) => {
                      const qty = Number(kulakanInput[item.namaBarang] || 0);
                      
                      const setQtyValue = (val) => {
                        const num = Math.max(0, val);
                        setKulakanInput(prev => ({
                          ...prev,
                          [item.namaBarang]: num === 0 ? '' : num
                        }));
                      };

                      return (
                        <div key={item.id} className="bg-white rounded-2xl border border-slate-100 p-3.5 shadow-sm hover:shadow-md transition-all flex items-center justify-between gap-4">
                          {/* Nama & Harga Produk */}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-black text-slate-800 truncate">{item.namaBarang}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-xs font-bold text-emerald-600">{formatRp(item.hargaSatuan)}</span>
                              <span className="text-[9px] text-slate-400 font-medium">/ {item.satuan}</span>
                            </div>
                            <p className="text-[8px] text-slate-400 font-mono mt-0.5">Kode: {item.id}</p>
                          </div>

                          {/* Tombol Plus Minus Kuantitas */}
                          <div className="flex items-center bg-slate-100 rounded-xl p-1 shrink-0 border border-slate-200/40">
                            <button
                              type="button"
                              onClick={() => setQtyValue(qty - 1)}
                              className="h-7 w-7 rounded-lg bg-white shadow-sm border border-slate-200/60 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={qty || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setQtyValue(val === '' ? 0 : Number(val));
                              }}
                              placeholder="0"
                              className="w-10 text-center text-xs font-black text-slate-800 bg-transparent outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setQtyValue(qty + 1)}
                              className="h-7 w-7 rounded-lg bg-white shadow-sm border border-slate-200/60 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Ringkasan Total Pesanan (Melayang/Glow) */}
                  {Object.values(kulakanInput).some(v => Number(v) > 0) && (
                    <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-lg border border-slate-800 flex items-center justify-between gap-4 animate-fade-in">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total Belanja</p>
                        <p className="text-lg font-black text-emerald-400 mt-0.5">
                          {formatRp(
                            Object.entries(kulakanInput).reduce((sum, [namaBarang, qty]) => {
                              const product = katalog.find(p => p.namaBarang === namaBarang);
                              return sum + ((Number(qty) || 0) * (product ? product.hargaSatuan : 0));
                            }, 0)
                          )}
                        </p>
                      </div>
                      
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] disabled:opacity-60 text-white rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider shadow-md shadow-emerald-950/40 transition-all"
                      >
                        {isLoading ? 'Mengirim...' : 'Kirim Pesanan'}
                      </button>
                    </div>
                  )}
                </form>
              )}
            </section>
          )}
        </main>

        <nav className="bg-white border-t border-slate-200 px-2 py-3 grid grid-cols-5 gap-1.5">
          <NavButton active={currentPage === 'beranda'} label="RAB" onClick={() => setCurrentPage('beranda')} />
          <NavButton active={currentPage === 'laporan'} label="Input" onClick={() => setCurrentPage('laporan')} />
          <NavButton active={currentPage === 'review'} label="Audit" onClick={() => setCurrentPage('review')} />
          <NavButton active={currentPage === 'gudang'} label="Gudang" onClick={() => setCurrentPage('gudang')} />
          <NavButton active={currentPage === 'kulakan'} label="Kulakan" onClick={() => setCurrentPage('kulakan')} />
        </nav>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone = 'slate', small = false }) {
  const tones = {
    slate: 'bg-white text-slate-900 border-slate-200',
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    red: 'bg-red-50 text-red-900 border-red-200',
  };

  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${tones[tone] || tones.slate}`}>
      <p className="text-[9px] font-black uppercase tracking-wide opacity-60">{label}</p>
      <p className={`${small ? 'text-[10px]' : 'text-sm'} font-black mt-1 leading-tight`}>{value}</p>
    </div>
  );
}

function Input({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase text-slate-500 mb-1">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold bg-slate-50 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function NavButton({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl py-2 text-[10px] font-black uppercase ${active ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-500'}`}
    >
      {label}
    </button>
  );
}

export default App;
