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

const getItemEmoji = (namaBarang) => {
  const name = String(namaBarang || '').toLowerCase();
  if (name.includes('beras')) return '🌾';
  if (name.includes('telur')) return '🥚';
  if (name.includes('minyak')) return '🛢️';
  if (name.includes('bawang')) return '🧅';
  if (name.includes('garam')) return '🧂';
  if (name.includes('merica') || name.includes('lada')) return '🌶️';
  if (name.includes('saos') || name.includes('saus') || name.includes('kecap')) return '🥫';
  if (name.includes('daging') || name.includes('sapi') || name.includes('ayam')) return '🥩';
  return '📦';
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Konversi file gambar ke data URL dengan KOMPRESI otomatis.
 * Foto dari HP bisa 4-10 MB (base64 ~13 MB) → menyebabkan crash React.
 * Fungsi ini resize ke maks 1200px & kompres ke JPEG 72% → hasil ≤ ~250 KB.
 */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    // Jika bukan gambar, gunakan FileReader biasa
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const MAX_PX = 1200;   // sisi terpanjang maksimum
    const QUALITY = 0.72;  // kualitas JPEG (0–1)

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // bebaskan memori segera

      let { width, height } = img;

      // Hitung dimensi baru jika perlu diperkecil
      if (width > MAX_PX || height > MAX_PX) {
        if (width >= height) {
          height = Math.round((height / width) * MAX_PX);
          width = MAX_PX;
        } else {
          width = Math.round((width / height) * MAX_PX);
          height = MAX_PX;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Ekspor sebagai JPEG dengan kompresi
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Gagal memuat gambar untuk kompresi'));
    };

    img.src = objectUrl;
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
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState('');

  const [namaDapurInput, setNamaDapurInput] = useState('');
  const [alamat, setAlamat] = useState('');
  const [email, setEmail] = useState('');
  const [noWa, setNoWa] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (sessionDapur) {
      setNamaDapurInput(sessionDapur.nama || '');
      setAlamat(sessionDapur.alamat || '');
      setEmail(sessionDapur.email || '');
      setNoWa(sessionDapur.no_wa || '');
    }
  }, [sessionDapur]);

  // State untuk laporan offline yang tertunda
  const [pendingReports, setPendingReports] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sppg_pending_reports') || '[]');
    } catch {
      return [];
    }
  });

  // Fungsi sinkronisasi laporan offline
  const syncPendingReports = async () => {
    const saved = JSON.parse(localStorage.getItem('sppg_pending_reports') || '[]');
    if (saved.length === 0) return;

    setIsLoading(true);
    setSyncStatus('Menghubungkan jaringan & sinkronisasi data...');
    
    let successCount = 0;
    const remaining = [];

    for (const payload of saved) {
      try {
        const response = await authFetch(`${API_BASE}/api/laporan`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (response.ok && data.success) {
          successCount++;
          
          // Google Sheets sync
          const postUrl = CENTRAL_SPREADSHEET_URL || (sessionDapur.urlApi ? sessionDapur.urlApi.split('?')[0] : '');
          if (postUrl) {
            try {
              const promises = payload.items.map((row) => {
                const rowPayload = {
                  idDapur: payload.idDapur || 'dapur01',
                  jenisInput: `REALISASI_OFFLINE`,
                  tanggalInput: payload.tanggalInput || new Date().toISOString().split('T')[0],
                  namaBarang: row.namaBarang,
                  qty: row.qty,
                  satuan: row.satuan,
                  harga: row.totalRiil / (row.qty || 1),
                  status: 'Realisasi',
                  linkNota: row.fotoNota ? 'Ada Foto' : '-'
                };
                return fetch(postUrl, {
                  method: 'POST',
                  mode: 'no-cors',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(rowPayload),
                });
              });
              await Promise.all(promises);
            } catch (err) {
              console.warn('Gagal sinkron Sheets offline:', err);
            }
          }
        } else {
          remaining.push(payload);
        }
      } catch (err) {
        remaining.push(payload);
      }
    }

    localStorage.setItem('sppg_pending_reports', JSON.stringify(remaining));
    setPendingReports(remaining);
    setIsLoading(false);

    if (successCount > 0) {
      alert(`Berhasil! ${successCount} laporan belanja offline berhasil disinkronisasikan ke database server.`);
      fetchStock();
    }
  };

  // Monitor jaringan online/offline
  useEffect(() => {
    const handleOnline = () => {
      setBackendStatus('Terhubung ke Internet.');
      syncPendingReports();
    };
    const handleOffline = () => {
      setBackendStatus('Anda sedang Offline.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [token, sessionDapur.id]);

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
  const [laporanInput, setLaporanInput] = useState(() => {
    try {
      const saved = localStorage.getItem('sppg_laporan_draft');
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      // Bersihkan penanda '__FOTO_ADA__' — bukan data foto sungguhan,
      // hanya penanda bahwa foto pernah ada. Tidak bisa di-restore.
      Object.keys(parsed).forEach(rowKey => {
        const inp = parsed[rowKey];
        if (!inp) return;
        if (inp.fotoNota === '__FOTO_ADA__') inp.fotoNota = null;
        if (Array.isArray(inp.receipts)) {
          inp.receipts.forEach(r => {
            if (r.foto === '__FOTO_ADA__') r.foto = null;
          });
        }
      });
      return parsed;
    } catch {
      return {};
    }
  });

  const [fotoMasakan, setFotoMasakan] = useState(() => {
    try {
      const val = localStorage.getItem('sppg_foto_masakan_draft');
      // '__FOTO_ADA__' hanya penanda — foto aslinya tidak tersimpan, kembalikan null
      if (!val || val === '__FOTO_ADA__') return null;
      // Hanya terima jika memang base64 gambar sungguhan
      return val.startsWith('data:image') ? val : null;
    } catch {
      return null;
    }
  });

  const [lastSubmit, setLastSubmit] = useState(null);
  const [draftSavedAt, setDraftSavedAt] = useState(() => {
    // Cek apakah ada draft yang tersimpan saat app dibuka
    try {
      const saved = localStorage.getItem('sppg_laporan_draft');
      const ts = localStorage.getItem('sppg_laporan_draft_ts');
      if (saved && JSON.parse(saved) && Object.keys(JSON.parse(saved)).length > 0 && ts) {
        return new Date(ts);
      }
    } catch {}
    return null;
  });

  // Simpan draft ke localStorage TANPA data base64 foto agar tidak melebihi kuota ~5MB.
  // Hanya metadata teks (qty, harga, sumber) yang disimpan. Keberadaan foto ditandai boolean.
  useEffect(() => {
    try {
      const draftSafe = {};
      let hasAnyValue = false;
      Object.keys(laporanInput).forEach(rowKey => {
        const inp = laporanInput[rowKey];
        if (!inp) return;
        // Cek apakah row ini punya nilai apapun (qty/harga/sumber non-default)
        const hasValue = !!(inp.qtyRiil || inp.hargaSatuanRiil || (inp.sumber && inp.sumber !== 'KOPERASI') || inp.fotoNota);
        if (hasValue) hasAnyValue = true;
        draftSafe[rowKey] = {
          sumber: inp.sumber,
          qtyRiil: inp.qtyRiil,
          hargaSatuanRiil: inp.hargaSatuanRiil,
          totalRiil: inp.totalRiil,
          // Simpan tanda bahwa foto sudah ada, tapi bukan data base64-nya
          fotoNota: inp.fotoNota ? '__FOTO_ADA__' : null,
          receipts: inp.receipts ? inp.receipts.map(r => ({
            id: r.id,
            qty: r.qty,
            hargaSatuan: r.hargaSatuan,
            // Tandai foto ada/tidak tanpa menyimpan base64
            foto: r.foto ? '__FOTO_ADA__' : null,
          })) : undefined,
        };
      });
      localStorage.setItem('sppg_laporan_draft', JSON.stringify(draftSafe));
      if (hasAnyValue) {
        const now = new Date();
        localStorage.setItem('sppg_laporan_draft_ts', now.toISOString());
        setDraftSavedAt(now);
      }
    } catch (e) {
      // Jika masih error (misal browser sangat terbatas), abaikan — jangan crash
      console.warn('Draft tidak dapat disimpan ke localStorage:', e.message);
    }
  }, [laporanInput]);

  useEffect(() => {
    // Foto masakan juga bisa besar; simpan hanya tanda keberadaannya, bukan base64 penuh
    try {
      if (fotoMasakan) {
        // Hanya simpan sebagian kecil sebagai penanda (bukan full base64)
        localStorage.setItem('sppg_foto_masakan_draft', '__FOTO_ADA__');
      } else {
        localStorage.removeItem('sppg_foto_masakan_draft');
      }
    } catch (e) {
      console.warn('Foto masakan draft tidak dapat disimpan:', e.message);
    }
  }, [fotoMasakan]);

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
  const [koperasiOrders, setKoperasiOrders] = useState([]);
  const [koperasiSubTab, setKoperasiSubTab] = useState('new');
  const [selectedPoForMerge, setSelectedPoForMerge] = useState([]);
  const [hariKirim, setHariKirim] = useState('SENIN');
  const [tanggalKirim, setTanggalKirim] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });

  const fetchKatalog = async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/koperasi/katalog`);
      const d = await res.json();
      if (d.success) setKatalog(d.data);
    } catch (e) {
      console.warn('Gagal fetch katalog:', e);
    }
  };

  const fetchKoperasiOrders = async () => {
    if (!sessionDapur.id) return;
    try {
      const res = await authFetch(`${API_BASE}/api/koperasi/order?idDapur=${sessionDapur.id}`);
      const d = await res.json();
      if (d.success) setKoperasiOrders(d.data);
    } catch (e) {
      console.warn('Gagal fetch koperasi orders:', e);
    }
  };

  const findStockItem = (name) => {
    if (!name) return null;
    const rName = name.toLowerCase().trim();
    return stock.find((s) => {
      const sName = s.namaBarang.toLowerCase().trim();
      return sName === rName || sName.includes(rName) || rName.includes(sName);
    });
  };

  const findStockIndex = (name) => {
    if (!name) return -1;
    const rName = name.toLowerCase().trim();
    return stock.findIndex((s) => {
      const sName = s.namaBarang.toLowerCase().trim();
      return sName === rName || sName.includes(rName) || rName.includes(sName);
    });
  };

  const shippedOrders = koperasiOrders.filter((o) => o.status === 'DIKIRIM');

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
      fetchKoperasiOrders();
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

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordChangeError('');
    setPasswordChangeSuccess('');

    if (newPassword.length < 4) {
      setPasswordChangeError('Password baru minimal 4 karakter.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordChangeError('Konfirmasi password tidak cocok.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await authFetch(`${API_BASE}/api/dapur/profile/password`, {
        method: 'PUT',
        body: JSON.stringify({ passwordBaru: newPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Gagal mengubah password.');
      }
      setPasswordChangeSuccess('Password berhasil diperbarui.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordChangeError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setIsLoading(true);

    try {
      const response = await authFetch(`${API_BASE}/api/dapur/profile`, {
        method: 'PUT',
        body: JSON.stringify({ nama: namaDapurInput, alamat, email, noWa }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Gagal memperbarui profil.');
      }

      const nextSession = { ...sessionDapur, ...data.data };
      setSessionDapur(nextSession);
      sessionStorage.setItem('sppg_session_dapur', JSON.stringify(nextSession));
      setProfileSuccess('Profil berhasil diperbarui.');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateRowReceipts = (rowKey, newReceipts) => {
    const qtyRiil = newReceipts.reduce((sum, r) => sum + toNumber(r.qty), 0);
    const totalRiil = newReceipts.reduce((sum, r) => sum + (toNumber(r.qty) * toNumber(r.hargaSatuan)), 0);
    const averageHarga = qtyRiil > 0 ? (totalRiil / qtyRiil) : 0;

    setLaporanInput((previous) => ({
      ...previous,
      [rowKey]: {
        sumber: 'KOPERASI',
        qtyRiil: '',
        hargaSatuanRiil: '',
        totalRiil: '',
        fotoNota: null,
        ...previous[rowKey],
        receipts: newReceipts,
        qtyRiil: qtyRiil,
        hargaSatuanRiil: averageHarga,
        totalRiil: totalRiil,
        fotoNota: JSON.stringify(newReceipts)
      },
    }));
  };

  const addReceipt = (rowKey) => {
    const input = laporanInput[rowKey] || {};
    const itemMatch = activeBomList.find((b, idx) => buildRowKey(b, idx) === rowKey);
    const currentReceipts = input.receipts || [
      {
        id: 'REC-init-' + Date.now(),
        qty: input.qtyRiil !== undefined ? input.qtyRiil : (itemMatch?.qtyRencana || 0),
        hargaSatuan: input.hargaSatuanRiil !== undefined ? input.hargaSatuanRiil : (itemMatch?.hargaRab || 0),
        foto: input.fotoNota || null
      }
    ];

    const newReceipts = [
      ...currentReceipts,
      {
        id: 'REC-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        qty: '',
        hargaSatuan: '',
        foto: null
      }
    ];

    updateRowReceipts(rowKey, newReceipts);
  };

  const removeReceipt = (rowKey, receiptId) => {
    const input = laporanInput[rowKey] || {};
    const currentReceipts = input.receipts || [];
    const newReceipts = currentReceipts.filter(r => r.id !== receiptId);
    
    if (newReceipts.length === 0) {
      newReceipts.push({
        id: 'REC-default-' + Date.now(),
        qty: '',
        hargaSatuan: '',
        foto: null
      });
    }

    updateRowReceipts(rowKey, newReceipts);
  };

  const updateReceiptField = async (rowKey, receiptId, field, value) => {
    const input = laporanInput[rowKey] || {};
    const itemMatch = activeBomList.find((b, idx) => buildRowKey(b, idx) === rowKey);
    const currentReceipts = input.receipts || [
      {
        id: 'REC-default',
        qty: input.qtyRiil ?? '',
        hargaSatuan: input.hargaSatuanRiil ?? '',
        foto: input.fotoNota || null
      }
    ];

    const newReceipts = await Promise.all(currentReceipts.map(async (r) => {
      if (r.id === receiptId) {
        if (field === 'fotoFile') {
          const encoded = await fileToDataUrl(value);
          return { ...r, foto: encoded };
        }
        return { ...r, [field]: value };
      }
      return r;
    }));

    updateRowReceipts(rowKey, newReceipts);
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
      const existingItem = findStockItem(namaNormal);
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
          items: itemsToOrder,
          hariKirim,
          tanggalKirim
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal mengirim order kulakan.');

      setKulakanInput({});
      setKoperasiSubTab('history');
      await fetchKoperasiOrders();
      alert('Pre Order Koperasi berhasil dibuat! Silakan upload bukti transfer pembayaran di tab Riwayat PO.');
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
        const existingIdx = findStockIndex(orderedItem.namaBarang);
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
      await fetchKoperasiOrders();
    } catch (err) {
      alert(`Gagal menerima barang: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadBuktiBayar = async (orderId, file) => {
    if (!file) return;
    setIsLoading(true);
    try {
      const encoded = await fileToDataUrl(file);
      const res = await authFetch(`${API_BASE}/api/koperasi/order/${orderId}/pembayaran`, {
        method: 'POST',
        body: JSON.stringify({ buktiPembayaran: encoded })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal mengunggah bukti pembayaran.');

      alert('Bukti pembayaran berhasil diunggah! Menunggu verifikasi Koperasi.');
      await fetchKoperasiOrders();
    } catch (err) {
      alert(`Gagal mengunggah bukti: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadBuktiBayarMassal = async (file) => {
    if (!file) return;
    if (selectedPoForMerge.length === 0) {
      alert('Mohon pilih minimal satu PO untuk dibayar.');
      return;
    }

    setIsLoading(true);
    try {
      const encoded = await fileToDataUrl(file);
      const res = await authFetch(`${API_BASE}/api/koperasi/orders/pembayaran-massal`, {
        method: 'POST',
        body: JSON.stringify({
          orderIds: selectedPoForMerge,
          buktiPembayaran: encoded
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal mengunggah bukti pembayaran massal.');

      alert(`Bukti pembayaran gabungan untuk ${selectedPoForMerge.length} PO berhasil diunggah! Menunggu verifikasi Koperasi.`);
      setSelectedPoForMerge([]);
      await fetchKoperasiOrders();
      setKoperasiSubTab('history');
    } catch (err) {
      alert(`Gagal mengirim pembayaran massal: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCetakNota = (order) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Mohon izinkan pop-up untuk mencetak nota.');
      return;
    }

    const itemsHtml = order.items.map((item, idx) => {
      const catalogItem = katalog.find(p => p.namaBarang === item.namaBarang);
      const sku = catalogItem?.sku || `S${String(idx + 1).padStart(3, '0')}`;
      return `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #1e293b;">
          <td style="padding: 10px 5px; text-align: center;">${idx + 1}</td>
          <td style="padding: 10px 5px; font-family: monospace;">${sku}</td>
          <td style="padding: 10px 5px; font-weight: bold;">${item.namaBarang.toUpperCase()}</td>
          <td style="padding: 10px 5px; text-align: center;">${item.qty} ${item.satuan}</td>
          <td style="padding: 10px 5px; text-align: right;">Rp ${Number(item.hargaSatuan).toLocaleString('id-ID')}</td>
          <td style="padding: 10px 5px; text-align: center;">-</td>
          <td style="padding: 10px 5px; text-align: center;">-</td>
          <td style="padding: 10px 5px; text-align: center;">-</td>
          <td style="padding: 10px 5px; text-align: right; font-weight: bold;">Rp ${Number(item.total).toLocaleString('id-ID')}</td>
        </tr>
      `;
    }).join('');

    const isLunas = order.status !== 'PENDING_PAYMENT';
    const totalTerbayar = isLunas ? order.totalHarga : 0;
    const sisaTagihan = isLunas ? 0 : order.totalHarga;
    const statusBadge = isLunas
      ? `<span style="border: 1px solid #2dd4bf; background: #f0fdfa; color: #0d9488; padding: 4px 15px; border-radius: 4px; font-size: 12px; font-weight: 800; font-family: sans-serif; text-transform: uppercase;">Lunas</span>`
      : `<span style="border: 1px solid #f87171; background: #fef2f2; color: #dc2626; padding: 4px 15px; border-radius: 4px; font-size: 12px; font-weight: 800; font-family: sans-serif;">Belum Lunas | Sisa Tagihan : Rp ${Number(order.totalHarga).toLocaleString('id-ID')}</span>`;

    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice - ${order.id}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
            body { font-family: 'Inter', sans-serif; color: #000; background: #fff; margin: 0; padding: 20px; font-size: 12px; }
            .container { max-width: 800px; margin: 0 auto; border: 1px solid #cbd5e1; padding: 30px; }
            .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; }
            .logo-container { display: flex; align-items: center; }
            .company-section { display: flex; justify-content: space-between; font-size: 11px; line-height: 1.5; margin-bottom: 25px; }
            .company-details { width: 55%; color: #334155; }
            .invoice-meta { width: 40%; }
            .address-section { display: flex; justify-content: space-between; margin-bottom: 25px; font-size: 11px; border-top: 1px solid #cbd5e1; padding-top: 15px; }
            .address-box { width: 48%; color: #334155; }
            .table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
            .table th { background: #f8fafc; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; padding: 8px 5px; font-size: 10px; text-transform: uppercase; color: #475569; font-weight: bold; }
            .table td { border-bottom: 1px solid #cbd5e1; padding: 10px 5px; }
            .totals-container { display: flex; justify-content: flex-end; margin-top: 15px; }
            .totals-table { width: 45%; border-collapse: collapse; font-size: 11px; }
            .totals-table td { padding: 6px 0; text-align: right; }
            .totals-table tr.grand-total td { font-weight: 800; border-top: 1.5px solid #000; padding-top: 8px; }
            .notes-section { margin-top: 30px; font-size: 11px; color: #334155; border-top: 1px solid #cbd5e1; padding-top: 15px; }
            .signature-section { display: flex; justify-content: flex-end; text-align: center; margin-top: 40px; }
            .signature-box { width: 200px; border-top: 1px solid #94a3b8; padding-top: 8px; font-size: 11px; font-weight: bold; margin-top: 50px; color: #1e293b; }
            @media print {
              body { padding: 0; }
              .container { border: none; padding: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div style="text-align: right;" class="no-print">
              <button onclick="window.print()" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; margin-bottom: 20px;">Cetak / Simpan PDF</button>
            </div>
            
            <div class="top-bar">
              <div>
                <span style="border: 1px solid #94a3b8; padding: 4px 15px; font-size: 12px; font-weight: 800; border-radius: 4px; font-family: sans-serif; text-transform: uppercase; margin-right: 10px; color: #1e293b;">Invoice</span>
                ${statusBadge}
              </div>
              <div class="logo-container">
                <svg width="60" height="60" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="#16a34a" />
                  <path d="M 50,15 L 85,35 L 85,75 L 50,95 L 15,75 L 15,35 Z" fill="none" stroke="#dc2626" stroke-width="4" />
                  <circle cx="50" cy="50" r="28" fill="#fff" />
                  <text x="50" y="55" font-size="9" font-weight="900" fill="#1e293b" text-anchor="middle" font-family="'Inter', sans-serif">KOPSYAH</text>
                  <text x="50" y="68" font-size="7.5" font-weight="900" fill="#16a34a" text-anchor="middle" font-family="'Inter', sans-serif">PODO JOYO</text>
                </svg>
              </div>
            </div>

            <div class="company-section">
              <div class="company-details">
                <strong style="font-size: 13px; color: #0f172a; display: block; margin-bottom: 4px;">PODO JOYO</strong>
                Jl. Raya Kwadungan RT. 01 RW 01 Ds. Tirak Kec. Kwadungan - Kab Ngawi, Jawa Timur<br />
                Hub: 085852340670<br />
                Email: indoniagabersama@gmail.com
              </div>
              <div class="invoice-meta">
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                  <tr><td style="text-align: left; font-weight: bold; padding: 2px 0;">No. Pesanan</td><td style="padding: 2px 0;">: SO/51/${new Date(order.createdAt).toISOString().split('T')[0].replace(/-/g, '')}/${order.id.split('-').pop()}</td></tr>
                  <tr><td style="text-align: left; font-weight: bold; padding: 2px 0;">No. Invoice</td><td style="padding: 2px 0;">: INV/51/${new Date(order.createdAt).toISOString().split('T')[0].replace(/-/g, '')}/${order.id.split('-').pop()}</td></tr>
                  <tr><td style="text-align: left; font-weight: bold; padding: 2px 0;">Tanggal Dibuat</td><td style="padding: 2px 0;">: ${new Date(order.createdAt).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</td></tr>
                  <tr><td style="text-align: left; font-weight: bold; padding: 2px 0;">Termin Pembayaran</td><td style="padding: 2px 0;">: ${new Date(order.createdAt).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</td></tr>
                </table>
              </div>
            </div>

            <div class="address-section">
              <div class="address-box">
                <strong style="color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;">Ditagihkan kepada:</strong><br />
                <span style="font-size: 12px; font-weight: 800; color: #0f172a; display: block; margin-top: 4px; margin-bottom: 2px;">${(sessionDapur.nama || order.namaDapur).toUpperCase()}</span>
                ${sessionDapur.alamat || 'Ds. Paron Kec. Paron, Ngawi'}<br />
                Telp: ${sessionDapur.no_wa || '08565517191'}<br />
                Email: ${sessionDapur.email || 'sppgdahliaparon@gmail.com'}
              </div>
              <div class="address-box">
                <strong style="color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;">Dikirimkan ke Alamat:</strong><br />
                <span style="font-size: 12px; font-weight: 800; color: #0f172a; display: block; margin-top: 4px; margin-bottom: 2px;">${(sessionDapur.nama || order.namaDapur).toUpperCase()}</span>
                ${sessionDapur.alamat || 'Ds. Paron Kec. Paron, Ngawi'}<br />
                Telp: ${sessionDapur.no_wa || '08565517191'}<br />
                Email: ${sessionDapur.email || 'sppgdahliaparon@gmail.com'}
              </div>
            </div>

            <table class="table">
              <thead>
                <tr>
                  <th style="width: 30px; text-align: center;">No.</th>
                  <th style="width: 80px; text-align: left;">SKU</th>
                  <th style="text-align: left;">Produk</th>
                  <th style="width: 100px; text-align: center;">Jumlah Satuan</th>
                  <th style="width: 100px; text-align: right;">Harga</th>
                  <th style="width: 60px; text-align: center;">Diskon (%)</th>
                  <th style="width: 85px; text-align: center;">Diskon (Rp)</th>
                  <th style="width: 60px; text-align: center;">Pajak</th>
                  <th style="width: 110px; text-align: right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div class="totals-container">
              <table class="totals-table">
                <tr>
                  <td style="text-align: left; color: #475569;">Subtotal 1 Barang</td>
                  <td style="font-weight: 600; color: #0f172a;">Rp ${Number(order.totalHarga).toLocaleString('id-ID')}</td>
                </tr>
                <tr>
                  <td style="text-align: left; font-weight: bold; color: #0f172a; padding-top: 8px;">Total Tagihan:</td>
                  <td style="font-weight: bold; color: #0f172a; padding-top: 8px;">Rp ${Number(order.totalHarga).toLocaleString('id-ID')}</td>
                </tr>
                <tr>
                  <td style="text-align: left; color: #475569;">Total Terbayar:</td>
                  <td style="color: #0f172a;">Rp ${Number(totalTerbayar).toLocaleString('id-ID')}</td>
                </tr>
                <tr class="grand-total" style="font-size: 12px;">
                  <td style="text-align: left; color: #dc2626;">Sisa Tagihan:</td>
                  <td style="color: #dc2626;">Rp ${Number(sisaTagihan).toLocaleString('id-ID')}</td>
                </tr>
              </table>
            </div>

            <div class="notes-section">
              <strong>Keterangan :</strong><br />
              Rekening Pembayaran BRI 005701004920308 a.n. KOPERASI PODO JOYO
            </div>

            <div class="signature-section">
              <div>
                <p style="margin: 0; font-size: 11px; color: #0f172a;">Ngawi, ${new Date(order.createdAt).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
                <div class="signature-box">
                  Hanif Rizki
                </div>
              </div>
            </div>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 500);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
      const isAmbilGudang = (input.sumber || 'KOPERASI') === 'AMBIL_GUDANG';
      const stockItem = findStockItem(item.namaBarang);
      
      let qtyRiil = toNumber(input.qtyRiil || item.qtyRencana);
      let hargaSatuanRiil = toNumber(input.hargaSatuanRiil || item.hargaRab);
      let totalRiil = qtyRiil * hargaSatuanRiil;
      let fotoNota = input.fotoNota;
      let isNotaMissing = !isAmbilGudang && !fotoNota;

      if (!isAmbilGudang && input.receipts && input.receipts.length > 0) {
        qtyRiil = input.receipts.reduce((sum, r) => sum + toNumber(r.qty), 0);
        totalRiil = input.receipts.reduce((sum, r) => sum + (toNumber(r.qty) * toNumber(r.hargaSatuan)), 0);
        hargaSatuanRiil = qtyRiil > 0 ? (totalRiil / qtyRiil) : 0;
        fotoNota = JSON.stringify(input.receipts);
        isNotaMissing = input.receipts.some(r => !r.foto);
      } else if (isAmbilGudang) {
        if (stockItem) {
          hargaSatuanRiil = stockItem.hargaSatuan || 0;
        }
        totalRiil = qtyRiil * hargaSatuanRiil;
        fotoNota = null;
        isNotaMissing = false;
      }

      const totalRab = item.qtyRencana * item.hargaRab;
      const selisih = totalRiil - totalRab;
      const deviasiPersen = totalRab > 0 ? (selisih / totalRab) * 100 : 0;

      return {
        ...item,
        rowKey,
        sumber: input.sumber || 'KOPERASI',
        qtyRiil,
        hargaSatuanRiil,
        totalRab,
        totalRiil,
        fotoNota,
        selisih,
        deviasiPersen,
        flagged: totalRiil <= 0 || isNotaMissing || deviasiPersen > 10,
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
        const stockItem = findStockItem(row.namaBarang);
        if (!stockItem || stockItem.qty < row.qtyRiil) {
          return true;
        }
      }
      return false;
    });

    if (insufficientStock) {
      const stockItem = findStockItem(insufficientStock.namaBarang);
      const qtyTersedia = stockItem ? stockItem.qty : 0;
      alert(`Stok gudang tidak mencukupi untuk "${insufficientStock.namaBarang}". Tersedia: ${qtyTersedia} ${insufficientStock.satuan}, Dibutuhkan: ${insufficientStock.qtyRiil} ${insufficientStock.satuan}. Silakan tambah stok terlebih dahulu di tab Gudang.`);
      setCurrentPage('gudang');
      return;
    }

    // 2. Validasi: harus ada minimal 1 bahan dalam daftar RAB hari ini
    if (audit.rows.length === 0) {
      alert('Tidak ada data bahan RAB untuk hari ini. Pastikan RAB sudah dimuat dari Spreadsheet sebelum mengirim laporan.');
      setCurrentPage('laporan');
      return;
    }

    // 3. Validasi input riil & foto nota lengkap untuk seluruh bahan belanja
    const incompleteItems = [];
    
    audit.rows.forEach((row) => {
      const input = laporanInput[row.rowKey] || {};
      const isAmbilGudang = row.sumber === 'AMBIL_GUDANG';
      
      if (isAmbilGudang) {
        // Untuk Ambil Gudang, cukup pastikan kuantitas dimasukkan dan > 0
        if (row.qtyRiil <= 0) {
          incompleteItems.push(`- ${row.namaBarang}: Kuantitas riil ambil gudang harus lebih dari 0.`);
        }
      } else {
        // Untuk Koperasi / Supplier Luar
        const receipts = input.receipts || [
          {
            id: 'REC-default',
            qty: input.qtyRiil,
            hargaSatuan: input.hargaSatuanRiil,
            foto: input.fotoNota
          }
        ];

        // Validasi qty & harga wajib diisi (independen dari foto)
        const hasEmptyVal = receipts.some(r => !r.qty || toNumber(r.qty) <= 0 || !r.hargaSatuan || toNumber(r.hargaSatuan) <= 0);
        // Validasi foto nota wajib ada (independen dari nilai)
        const hasMissingPhoto = receipts.some(r => !r.foto);

        // Masing-masing divalidasi terpisah — keduanya WAJIB terpenuhi
        if (hasEmptyVal) {
          incompleteItems.push(`- ${row.namaBarang}: Kuantitas dan harga riil wajib diisi (tidak boleh 0 atau kosong).`);
        }
        if (hasMissingPhoto) {
          incompleteItems.push(`- ${row.namaBarang}: Foto nota belanja wajib diupload.`);
        }
      }
    });

    if (incompleteItems.length > 0) {
      alert(`BELUM SEMUA LAPORAN DIISI LENGKAP!\n\nMohon lengkapi data bahan berikut sebelum mengirim laporan:\n${incompleteItems.join('\n')}\n\n(Bahan dari gudang mandiri tidak memerlukan foto nota, namun kuantitas ambil gudang wajib diisi).`);
      setCurrentPage('laporan');
      return;
    }

    if (!fotoMasakan) {
      alert('Foto masakan matang wajib diunggah sebelum laporan dikirim.');
      return;
    }

    if (!window.confirm('Apakah Anda yakin seluruh data belanja dan foto masakan sudah benar dan siap dikirim ke Yayasan?')) {
      return;
    }

    setIsLoading(true);
    const payload = {
      idDapur: sessionDapur.id,
      namaDapur: sessionDapur.nama,
      tanggalInput: new Date().toISOString().split('T')[0],
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

    try {
      if (!navigator.onLine) {
        throw new Error('OFFLINE_MODE');
      }

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
      // Bersihkan draft setelah sukses kirim online
      setLaporanInput({});
      setFotoMasakan(null);
      localStorage.removeItem('sppg_laporan_draft');
      localStorage.removeItem('sppg_foto_masakan_draft');

      // Ambil data stok terbaru dari server (stok sudah berkurang otomatis di backend)
      await fetchStock();
      alert('Laporan berhasil dikirim dan diaudit backend.');
      setCurrentPage('review');
    } catch (error) {
      if (error.message === 'OFFLINE_MODE' || error.name === 'TypeError' || error.message.includes('fetch')) {
        const updated = [...pendingReports, payload];
        localStorage.setItem('sppg_pending_reports', JSON.stringify(updated));
        setPendingReports(updated);

        // Bersihkan draft setelah sukses disimpan ke antrean offline
        setLaporanInput({});
        setFotoMasakan(null);
        localStorage.removeItem('sppg_laporan_draft');
        localStorage.removeItem('sppg_foto_masakan_draft');

        alert('Anda sedang offline atau koneksi ke server Express terputus. Laporan Anda telah disimpan dengan aman di memori HP dan akan otomatis dikirimkan ke server ketika internet aktif kembali.');
        setCurrentPage('beranda');
      } else {
        alert(`Gagal kirim laporan: ${error.message}`);
      }
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
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  setPasswordChangeError('');
                  setPasswordChangeSuccess('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setCurrentPage('akun');
                }}
                className={`rounded-lg px-3 py-2 text-[10px] font-bold transition-all ${
                  currentPage === 'akun' ? 'bg-white text-emerald-800' : 'bg-emerald-950/40 text-white'
                }`}
              >
                Akun
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Apakah Anda yakin ingin keluar dari sistem?')) {
                    sessionStorage.removeItem('sppg_token');
                    sessionStorage.removeItem('sppg_session_dapur');
                    setToken('');
                    setIsLoggedIn(false);
                    setSessionDapur(demoSession);
                  }
                }}
                className="bg-emerald-950/40 rounded-lg px-3 py-2 text-[10px] font-bold"
              >
                Keluar
              </button>
            </div>
          </div>
        </header>

        {pendingReports.length > 0 && (
          <div className="bg-amber-500 text-slate-950 px-4 py-2.5 text-[10px] font-black tracking-wide flex items-center justify-between shadow-sm shrink-0">
            <span className="flex items-center gap-1.5">⚠️ {pendingReports.length} Laporan Tertunda (Offline)</span>
            <button 
              onClick={syncPendingReports} 
              className="bg-slate-900 text-white rounded-lg px-2.5 py-1.5 font-bold text-[9px] hover:bg-slate-800 transition-colors uppercase active:scale-95 duration-100"
            >
              Sync Sekarang
            </button>
          </div>
        )}

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
              {deferredPrompt && (
                <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl p-4 shadow-md flex items-center justify-between border border-emerald-500/20">
                  <div className="space-y-1 max-w-[70%]">
                    <h3 className="text-xs font-black uppercase tracking-wider text-emerald-100">Pasang Aplikasi</h3>
                    <p className="text-[11px] font-bold text-white">Instal aplikasi di layar utama HP untuk penggunaan offline lebih cepat!</p>
                  </div>
                  <button 
                    onClick={handleInstallPWA} 
                    className="bg-white text-emerald-800 rounded-xl px-3 py-2 text-[10px] font-black shadow-lg shadow-emerald-950/20 active:scale-95 transition-transform"
                  >
                    Pasang Sekarang
                  </button>
                </div>
              )}

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
                {/* Banner draft tersimpan */}
                {draftSavedAt && (
                  <div className="mt-3 flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-500 text-base">💾</span>
                      <div>
                        <p className="text-[10px] font-black text-emerald-700">Draft Tersimpan Otomatis</p>
                        <p className="text-[9px] text-emerald-500">
                          {draftSavedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} — data tidak hilang meski keluar aplikasi
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm('Hapus semua draft input yang tersimpan? Seluruh nilai qty, harga, dan sumber akan direset.')) {
                          localStorage.removeItem('sppg_laporan_draft');
                          localStorage.removeItem('sppg_laporan_draft_ts');
                          localStorage.removeItem('sppg_foto_masakan_draft');
                          setLaporanInput({});
                          setFotoMasakan(null);
                          setDraftSavedAt(null);
                        }
                      }}
                      className="text-[9px] font-bold text-red-500 border border-red-200 rounded-lg px-2 py-1 bg-white hover:bg-red-50 flex-shrink-0"
                    >
                      Hapus Draft
                    </button>
                  </div>
                )}
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
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-amber-200 mb-1">Pilih Foto Nota (Galeri/Kamera)</span>
                      <input
                        type="file"
                        accept="image/*"
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
                  
                  // Get audited row data (which handles pricing automatically)
                  const auditedRow = audit.rows.find(r => r.rowKey === rowKey) || {};
                  const totalRab = auditedRow.totalRab || (item.qtyRencana * item.hargaRab);
                  const totalRiil = auditedRow.totalRiil || 0;
                  const deviasi = auditedRow.deviasiPersen || 0;
                  const isAmbilGudang = auditedRow.sumber === 'AMBIL_GUDANG';

                  const stockItem = findStockItem(item.namaBarang);
                  const hasStock = !!(stockItem && stockItem.qty > 0);

                  // Auto reset to KOPERASI if AMBIL_GUDANG selected but has no stock
                  if (input.sumber === 'AMBIL_GUDANG' && !hasStock) {
                    setTimeout(() => updateInput(rowKey, 'sumber', 'KOPERASI'), 0);
                  }

                  return (
                    <div key={rowKey} className={`bg-white rounded-2xl border p-4 shadow-sm space-y-3 ${
                      (input.qtyRiil || input.hargaSatuanRiil)
                        ? 'border-emerald-300 ring-1 ring-emerald-100'
                        : 'border-slate-200'
                    }`}>
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

                      {/* Sumber Bahan */}
                      <div>
                        <label className="block">
                          <span className="block text-[10px] font-bold text-slate-500 mb-1">Sumber Bahan</span>
                          <select
                            value={input.sumber || 'KOPERASI'}
                            onChange={(event) => updateInput(rowKey, 'sumber', event.target.value)}
                            className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none"
                          >
                            <option value="KOPERASI">Koperasi</option>
                            <option value="SUPPLIER_LUAR">Supplier Luar</option>
                            {hasStock ? (
                              <option value="AMBIL_GUDANG">Ambil Gudang (Stok: {stockItem.qty} {item.satuan})</option>
                            ) : (
                              <option value="AMBIL_GUDANG" disabled>Ambil Gudang (Stok Kosong)</option>
                            )}
                          </select>
                        </label>
                      </div>

                      {isAmbilGudang ? (
                        /* Ambil Gudang Layout */
                        <>
                          <div className="grid grid-cols-2 gap-3">
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
                            <label className="block">
                              <span className="block text-[10px] font-bold text-slate-500 mb-1">Harga Satuan Riil</span>
                              <input
                                type="number"
                                value={stockItem ? stockItem.hargaSatuan : ''}
                                disabled
                                className="w-full bg-slate-200 text-slate-500 border border-slate-300 font-extrabold cursor-not-allowed rounded-lg p-2 text-xs outline-none"
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <div className="block">
                              <span className="block text-[10px] font-bold text-slate-500 mb-1">Total Riil</span>
                              <p className="text-xs font-black text-slate-800 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                                {formatRp(totalRiil)}
                              </p>
                            </div>
                          </div>
                          <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl p-3 text-[10px] font-bold space-y-1">
                            <p>✓ Diambil dari Gudang Mandiri Dapur. Tidak memerlukan upload foto nota belanja.</p>
                            <p className="text-emerald-700 font-extrabold">Stok Gudang Tersedia: {stockItem ? stockItem.qty : 0} {item.satuan}</p>
                          </div>
                        </>
                      ) : (
                        /* Koperasi & Supplier Luar Layout */
                        <div className="space-y-3">
                          <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Daftar Nota Belanja</span>
                          
                          {(() => {
                            const receipts = input.receipts || [
                              {
                                id: 'REC-default',
                                qty: input.qtyRiil !== undefined ? input.qtyRiil : item.qtyRencana,
                                hargaSatuan: input.hargaSatuanRiil !== undefined ? input.hargaSatuanRiil : item.hargaRab,
                                foto: input.fotoNota || null
                              }
                            ];

                            return (
                              <div className="space-y-3">
                                {receipts.map((rec, rIdx) => {
                                  const recQty = rec.qty === '' ? '' : Number(rec.qty);
                                  const recHarga = rec.hargaSatuan === '' ? '' : Number(rec.hargaSatuan);
                                  const recTotal = (recQty || 0) * (recHarga || 0);

                                  return (
                                    <div key={rec.id} className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 space-y-3 relative">
                                      <div className="flex justify-between items-center border-b border-slate-200/60 pb-1.5">
                                        <span className="text-[10px] font-extrabold text-slate-700">Nota Kuitansi #{rIdx + 1}</span>
                                        {receipts.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => removeReceipt(rowKey, rec.id)}
                                            className="text-[9px] font-black text-rose-500 bg-rose-50 border border-rose-100 hover:bg-rose-100 rounded-md px-1.5 py-0.5 transition-colors"
                                          >
                                            Hapus Nota
                                          </button>
                                        )}
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <label className="block">
                                          <span className="block text-[9px] font-bold text-slate-500 mb-0.5">Kuantitas ({item.satuan})</span>
                                          <input
                                            type="number"
                                            step="any"
                                            value={rec.qty ?? ''}
                                            onChange={(e) => updateReceiptField(rowKey, rec.id, 'qty', e.target.value)}
                                            placeholder="0"
                                            className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs outline-none"
                                          />
                                        </label>
                                        <label className="block">
                                          <span className="block text-[9px] font-bold text-slate-500 mb-0.5">Harga Satuan (Rp)</span>
                                          <input
                                            type="number"
                                            value={rec.hargaSatuan ?? ''}
                                            onChange={(e) => updateReceiptField(rowKey, rec.id, 'hargaSatuan', e.target.value)}
                                            placeholder={item.hargaRab}
                                            className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs outline-none"
                                          />
                                        </label>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2 items-center">
                                        <div>
                                          <span className="block text-[9px] font-bold text-slate-400">Subtotal Nota</span>
                                          <span className="text-xs font-black text-slate-800">{formatRp(recTotal)}</span>
                                        </div>
                                        <div className="space-y-1">
                                          <input
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => updateReceiptField(rowKey, rec.id, 'fotoFile', e.target.files[0])}
                                            className="w-full text-[9px] file:mr-1 file:rounded-md file:border-0 file:bg-slate-900 file:text-white file:px-2 file:py-1"
                                          />
                                          <p className={`text-[8px] font-black ${rec.foto ? 'text-emerald-600' : 'text-red-500'}`}>
                                            {rec.foto ? '✓ Foto tersimpan.' : '⚠ Foto kosong.'}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => addReceipt(rowKey)}
                                  className="w-full flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black py-2 rounded-xl transition-all shadow-sm active:scale-95"
                                >
                                  + Tambah Nota Kuitansi Baru
                                </button>
                                <div className="bg-slate-100 rounded-xl p-3 border border-slate-200/40 grid grid-cols-2 gap-2">
                                  <div>
                                    <span className="block text-[9px] font-bold text-slate-500">Total Kuantitas Riil</span>
                                    <span className="text-xs font-black text-slate-800">{receipts.reduce((s, r) => s + (Number(r.qty) || 0), 0)} {item.satuan}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[9px] font-bold text-slate-500">Total Harga Riil</span>
                                    <span className="text-xs font-black text-emerald-600">{formatRp(totalRiil)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      <p className={`text-[10px] font-bold rounded-lg p-2 ${deviasi > 10 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500'}`}>
                        Deviasi terhadap RAB: {Number.isFinite(deviasi) ? deviasi.toFixed(1) : '0.0'}%
                      </p>
                    </div>
                  );
                })
              )}
              {activeBomList.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setCurrentPage('review')}
                    className="w-full bg-slate-900 text-white rounded-2xl py-4 text-xs font-black uppercase tracking-widest shadow-sm hover:bg-slate-800 transition-colors"
                  >
                    Lanjut ke Kirim Laporan →
                  </button>
                </div>
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
                  onChange={(event) => handleFotoMasakan(event.target.files[0])}
                  className="w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-emerald-700 file:text-white file:px-3 file:py-2"
                />
                {fotoMasakan && <p className="text-[10px] text-emerald-600 font-bold mt-2">Foto masakan siap dikirim.</p>}
              </div>

              {lastSubmit && (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
                    <p className="text-xs font-black text-emerald-800">Laporan terkirim: {lastSubmit.id}</p>
                    <p className="text-[10px] text-emerald-700">Audit lokal & data Sheets otomatis diperbarui.</p>
                  </div>
                  
                  {/* AI Koperasi Signal Card */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">Rasio Belanja Koperasi</span>
                      <span className={`text-xs font-black px-2 py-0.5 rounded-md ${
                        (lastSubmit.audit?.persenKoperasi || 0) < 50 
                          ? 'bg-rose-100 text-rose-700 border border-rose-200' 
                          : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      }`}>
                        {Math.round(lastSubmit.audit?.persenKoperasi || 0)}%
                      </span>
                    </div>
                    
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-full ${(lastSubmit.audit?.persenKoperasi || 0) < 50 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                        style={{ width: `${Math.round(lastSubmit.audit?.persenKoperasi || 0)}%` }}
                      ></div>
                    </div>

                    <div className="p-3 bg-white/80 border border-indigo-100 rounded-xl space-y-1.5">
                      <p className="font-bold text-[9px] uppercase tracking-wider text-indigo-700 flex items-center gap-1">
                        <span>🤖</span> AI Sinyal & Saran Koperasi
                      </p>
                      <p className="text-[11px] leading-relaxed text-slate-800 font-bold">
                        {lastSubmit.audit?.aiAdvisory || 'AI sedang memproses saran belanja...'}
                      </p>
                    </div>

                    {(lastSubmit.audit?.persenKoperasi || 0) < 50 ? (
                      <div className="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-100 rounded-lg py-2 text-center">
                        ⚠️ BELUM MEMENUHI TARGET MINIMAL 50%
                      </div>
                    ) : (
                      <div className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg py-2 text-center">
                        ✅ MEMENUHI TARGET MINIMAL 50%
                      </div>
                    )}
                  </div>
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
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Foto Nota / Bukti (Galeri/Kamera)</span>
                    <input
                      type="file"
                      accept="image/*"
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
                <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-100">Pre Order Koperasi Pusat</h2>
                <p className="text-[10px] text-emerald-200/90 mt-1 leading-relaxed">
                  Pesan bahan baku curah / grosir berkualitas langsung dari Koperasi Pusat untuk mengisi kembali stok dapur Anda.
                </p>
              </div>

              <div className="flex gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setKoperasiSubTab('new')}
                  className={`flex-1 text-center py-2 text-[10px] font-bold rounded-lg transition-all ${koperasiSubTab === 'new' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Buat PO Baru
                </button>
                <button
                  type="button"
                  onClick={() => setKoperasiSubTab('history')}
                  className={`flex-1 text-center py-2 text-[10px] font-bold rounded-lg transition-all ${koperasiSubTab === 'history' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Riwayat PO (${koperasiOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setKoperasiSubTab('pembayaran')}
                  className={`flex-1 text-center py-2 text-[10px] font-bold rounded-lg transition-all ${koperasiSubTab === 'pembayaran' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Bayar Gabungan (${koperasiOrders.filter(o => o.status === 'PENDING_PAYMENT').length})
                </button>
              </div>

              {koperasiSubTab === 'new' && (
                katalog.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400 shadow-sm">
                    Tidak ada produk yang tersedia di katalog saat ini.
                  </div>
                ) : (
                  <form onSubmit={handleSubmitKulakan} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {katalog.map((item) => {
                        const qty = Number(kulakanInput[item.namaBarang] || 0);
                        const limitStok = Number(item.stok ?? 9999);
                        const isOutOfStock = limitStok <= 0;
                        
                        const setQtyValue = (val) => {
                          const num = Math.min(limitStok, Math.max(0, val));
                          setKulakanInput(prev => ({
                            ...prev,
                            [item.namaBarang]: num === 0 ? '' : num
                          }));
                        };

                        return (
                          <div key={item.id} className={`bg-white rounded-3xl border ${isOutOfStock ? 'border-slate-100 opacity-60' : 'border-slate-100'} p-3 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3 relative overflow-hidden`}>
                            <div className="absolute right-2 top-2 bg-slate-100 text-slate-500 font-mono text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                              {item.sku || 'N/A'}
                            </div>

                            <div className="flex items-center gap-2 mt-1 pr-10">
                              {item.foto ? (
                                <img 
                                  src={item.foto.startsWith('http') ? item.foto : `${API_BASE}${item.foto}`} 
                                  alt={item.namaBarang} 
                                  className="h-9 w-9 object-cover rounded-2xl border border-slate-100 shrink-0"
                                />
                              ) : (
                                <span className="text-2xl shrink-0">{getItemEmoji(item.namaBarang)}</span>
                              )}
                              <div className="min-w-0">
                                <h4 className="text-[11px] font-black text-slate-800 truncate leading-snug">{item.namaBarang}</h4>
                                <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">{item.satuan}</p>
                              </div>
                            </div>

                            <div>
                              <p className="text-xs font-black text-emerald-600">{formatRp(item.hargaSatuan)}</p>
                              
                              <div className="mt-1 flex items-center justify-between">
                                <span className="text-[9px] text-slate-400 font-bold">Stok Koperasi</span>
                                <span className={`text-[9px] font-black ${isOutOfStock ? 'text-rose-500' : 'text-slate-700'}`}>
                                  {isOutOfStock ? 'Habis' : `${limitStok} ${item.satuan}`}
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 h-1 rounded-full mt-1 overflow-hidden">
                                <div 
                                  className={`h-full ${isOutOfStock ? 'bg-rose-500' : limitStok < 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${isOutOfStock ? 0 : Math.min(100, (limitStok / 500) * 100)}%` }}
                                ></div>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                              {isOutOfStock ? (
                                <span className="w-full text-center text-[9px] font-black text-rose-500 uppercase tracking-wider py-1.5 bg-rose-50 rounded-xl">Stok Habis</span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setQtyValue(qty - 1)}
                                    disabled={qty <= 0}
                                    className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-slate-200 active:scale-95 disabled:opacity-40 transition-all"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    max={limitStok}
                                    value={qty || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const num = val === '' ? 0 : Number(val);
                                      setQtyValue(num);
                                    }}
                                    placeholder="0"
                                    className="w-8 text-center text-xs font-black text-slate-800 bg-transparent outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setQtyValue(qty + 1)}
                                    disabled={qty >= limitStok}
                                    className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-slate-200 active:scale-95 disabled:opacity-40 transition-all"
                                  >
                                    +
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {Object.values(kulakanInput).some(v => Number(v) > 0) && (
                      <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-lg border border-slate-800 space-y-4 animate-fade-in">
                        <div className="grid grid-cols-2 gap-3 border-b border-slate-800 pb-3">
                          <label className="block">
                            <span className="block text-[9px] font-bold text-slate-400 mb-1 uppercase">Hari Pengiriman</span>
                            <select
                              value={hariKirim}
                              onChange={(e) => setHariKirim(e.target.value)}
                              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white outline-none focus:border-emerald-500"
                              required
                            >
                              <option value="SENIN">Senin</option>
                              <option value="SELASA">Selasa</option>
                              <option value="RABU">Rabu</option>
                              <option value="KAMIS">Kamis</option>
                              <option value="JUMAT">Jumat</option>
                              <option value="SABTU">Sabtu</option>
                              <option value="MINGGU">Minggu</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="block text-[9px] font-bold text-slate-400 mb-1 uppercase">Tanggal Pengiriman</span>
                            <input
                              type="date"
                              value={tanggalKirim}
                              onChange={(e) => setTanggalKirim(e.target.value)}
                              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white outline-none focus:border-emerald-500"
                              required
                            />
                          </label>
                        </div>

                        <div className="flex items-center justify-between gap-4">
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
                            {isLoading ? 'Mengirim...' : 'Kirim PO Koperasi'}
                          </button>
                        </div>
                      </div>
                    )}
                  </form>
                )
              )}

              {koperasiSubTab === 'history' && (
                koperasiOrders.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400 shadow-sm">
                    Belum ada riwayat pemesanan Pre Order.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {koperasiOrders.map((order) => {
                      const dateStr = new Date(order.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' });
                      
                      let statusText = '';
                      let statusColor = '';
                      let detailsBlock = null;

                      if (order.status === 'PENDING_PAYMENT') {
                        statusText = 'Belum Dibayar (Pending)';
                        statusColor = 'bg-slate-100 text-slate-600 border-slate-200';
                        detailsBlock = (
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                            <p className="text-[10px] text-slate-500 leading-relaxed">
                              Silakan lakukan pembayaran sebesar <strong className="text-slate-800">{formatRp(order.totalHarga)}</strong> via transfer bank ke Rekening Koperasi Pusat:
                              <br />
                              <strong className="text-slate-800">BSI 777-888-9990 a.n. KOPERASI SPPG</strong>
                              <br />
                              Setelah transfer, foto dan upload bukti pembayarannya di bawah ini:
                            </p>
                            <div className="flex flex-col gap-2">
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleUploadBuktiBayar(order.id, e.target.files[0])}
                                className="w-full text-[10px] file:mr-2 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:px-3 file:py-1.5"
                              />
                            </div>
                          </div>
                        );
                      } else if (order.status === 'WAITING_APPROVAL') {
                        statusText = 'Verifikasi Pembayaran';
                        statusColor = 'bg-amber-50 text-amber-700 border-amber-200';
                        detailsBlock = (
                          <div className="bg-amber-50/50 border border-amber-100 text-[10px] text-amber-700 font-bold p-3 rounded-xl">
                            ℹ️ Bukti transfer sudah dikirim. Menunggu verifikasi dari pihak Admin Koperasi.
                          </div>
                        );
                      } else if (order.status === 'APPROVED') {
                        statusText = 'Pembayaran Disetujui (Siap Kirim)';
                        statusColor = 'bg-teal-50 text-teal-700 border-teal-200';
                        detailsBlock = (
                          <div className="space-y-2">
                            <div className="bg-teal-50/50 border border-teal-100 text-[10px] text-teal-700 font-bold p-3 rounded-xl">
                              ✓ Pembayaran Lunas. Pesanan sedang dipersiapkan untuk pengiriman.
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCetakNota(order)}
                              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs py-2.5 rounded-xl uppercase tracking-wider shadow-sm transition-all"
                            >
                              Unduh / Cetak Nota Pelunasan
                            </button>
                          </div>
                        );
                      } else if (order.status === 'DIKIRIM') {
                        statusText = 'Dalam Pengiriman';
                        statusColor = 'bg-blue-50 text-blue-700 border-blue-200';
                        detailsBlock = (
                          <div className="space-y-2">
                            <div className="bg-blue-50/50 border border-blue-100 text-[10px] text-blue-700 font-bold p-3 rounded-xl">
                              🚚 Barang dalam perjalanan. Klik tombol di bawah setelah barang tiba fisik di dapur.
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleCetakNota(order)}
                                className="flex-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-bold text-xs py-2 rounded-xl transition-all"
                              >
                                Nota Pelunasan
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTerimaOrder(order)}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs py-2 rounded-xl uppercase tracking-wider transition-all"
                              >
                                Terima Barang
                              </button>
                            </div>
                          </div>
                        );
                      } else {
                        statusText = 'Selesai';
                        statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        detailsBlock = (
                          <button
                            type="button"
                            onClick={() => handleCetakNota(order)}
                            className="w-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-bold text-xs py-2.5 rounded-xl transition-all"
                          >
                            Lihat Nota Pelunasan
                          </button>
                        );
                      }

                      return (
                        <div key={order.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
                          <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                            <div>
                              <span className="text-[8px] font-bold text-slate-400 uppercase">ID PO: #{order.id}</span>
                              <p className="text-xs text-slate-500 mt-0.5">{dateStr}</p>
                              {order.hariKirim && (
                                <p className="text-[10px] text-emerald-600 font-bold mt-1">
                                  🚚 Rencana Kirim: {order.hariKirim}, {new Date(order.tanggalKirim).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </p>
                              )}
                            </div>
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${statusColor}`}>
                              {statusText}
                            </span>
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-600">
                            {order.items.map((i) => (
                              <div key={i.namaBarang} className="flex justify-between">
                                <span>{i.namaBarang} ({i.qty} {i.satuan})</span>
                                <span className="font-bold text-slate-800">{formatRp(i.total)}</span>
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-between items-center border-t border-slate-100 pt-3">
                            <span className="text-[10px] font-black uppercase text-slate-400">Total Tagihan</span>
                            <span className="text-sm font-black text-emerald-600">{formatRp(order.totalHarga)}</span>
                          </div>

                          {detailsBlock}
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {koperasiSubTab === 'pembayaran' && (() => {
                const pendingPos = koperasiOrders.filter(o => o.status === 'PENDING_PAYMENT');
                const selectedTotal = pendingPos
                  .filter(o => selectedPoForMerge.includes(o.id))
                  .reduce((sum, o) => sum + Number(o.totalHarga), 0);

                return (
                  <div className="space-y-4 animate-fade-in">
                    <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm border border-slate-800">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Instruksi Pembayaran Gabungan</h3>
                      <p className="text-[10px] text-slate-300 mt-2 leading-relaxed">
                        1. Pilih satu atau beberapa tagihan Pre Order (PO) di bawah ini yang ingin dilunasi bersamaan.
                        <br />
                        2. Transfer total nominal gabungan ke Rekening Koperasi Pusat:
                        <br />
                        <span className="font-extrabold text-emerald-400 text-xs">BSI 777-888-9990 a.n. KOPERASI SPPG</span>
                        <br />
                        3. Foto & unggah satu bukti transfer gabungan tersebut untuk melunasi semua PO yang dipilih.
                      </p>
                    </div>

                    {pendingPos.length === 0 ? (
                      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400 shadow-sm">
                        Tidak ada tagihan PO Koperasi yang belum dibayar.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Daftar Tagihan Belum Dibayar:</span>
                        
                        {pendingPos.map(order => {
                          const dateStr = new Date(order.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' });
                          const isChecked = selectedPoForMerge.includes(order.id);

                          return (
                            <div 
                              key={order.id} 
                              onClick={() => {
                                setSelectedPoForMerge(prev => 
                                  prev.includes(order.id) 
                                    ? prev.filter(id => id !== order.id) 
                                    : [...prev, order.id]
                                );
                              }}
                              className={`bg-white rounded-2xl border p-4 shadow-sm transition-all cursor-pointer flex items-start gap-3 ${isChecked ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-200'}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 mt-0.5 cursor-pointer"
                              />
                              <div className="flex-1 space-y-2">
                                <div className="flex justify-between items-start border-b border-slate-100 pb-2">
                                  <div>
                                    <span className="text-[8px] font-bold text-slate-400 uppercase">ID PO: #{order.id}</span>
                                    <p className="text-[10px] text-slate-500 mt-0.5">{dateStr}</p>
                                  </div>
                                  <span className="text-xs font-black text-slate-800">{formatRp(order.totalHarga)}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 space-y-0.5">
                                  {order.items.map(i => (
                                    <div key={i.namaBarang} className="flex justify-between">
                                      <span>{i.namaBarang} ({i.qty} {i.satuan})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {selectedPoForMerge.length > 0 && (
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
                            <div className="flex justify-between items-center border-b border-slate-200/60 pb-2">
                              <div>
                                <span className="text-[9px] font-bold text-slate-500 uppercase">PO Terpilih</span>
                                <p className="text-xs font-black text-slate-800">{selectedPoForMerge.length} PO dipilih</p>
                              </div>
                              <div className="text-right">
                                <span className="text-[9px] font-bold text-slate-500 uppercase">Total Bayar Gabungan</span>
                                <p className="text-sm font-black text-emerald-600">{formatRp(selectedTotal)}</p>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="block">
                                <span className="block text-[10px] font-bold text-slate-500 mb-1">Unggah Satu Struk Bukti Transfer</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleUploadBuktiBayarMassal(e.target.files[0])}
                                  className="w-full text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:text-white file:px-4 file:py-2 file:text-xs"
                                />
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>
          )}

          {currentPage === 'akun' && (
            <section className="p-4 space-y-4 animate-fade-in">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-2">
                <h2 className="text-sm font-black text-slate-800">Profil & Akun Dapur</h2>
                <div className="text-xs space-y-1.5 text-slate-600 mt-2">
                  <p><strong>ID Dapur:</strong> {sessionDapur.id}</p>
                  <p><strong>Nama Dapur:</strong> {sessionDapur.nama}</p>
                  <p><strong>Username:</strong> {sessionDapur.username || '-'}</p>
                  <p><strong>Batas Anggaran:</strong> {formatRp(rabData.batasAnggaran)}</p>
                  <p><strong>Target Porsi:</strong> {Number(rabData.targetPorsi).toLocaleString('id-ID')} Porsi</p>
                  <hr className="my-2 border-slate-100" />
                  <p><strong>Alamat:</strong> {sessionDapur.alamat || '-'}</p>
                  <p><strong>Email:</strong> {sessionDapur.email || '-'}</p>
                  <p><strong>No. WhatsApp:</strong> {sessionDapur.no_wa || '-'}</p>
                </div>
              </div>

              <form onSubmit={handleUpdateProfile} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-600">Edit Data Dapur</h3>
                  <p className="text-[10px] text-slate-400 mt-1">Perbarui alamat dapur, alamat email, dan nomor WhatsApp kontak aktif.</p>
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="block text-[10px] font-bold text-slate-500 mb-1">Nama Dapur</span>
                    <input
                      type="text"
                      value={namaDapurInput}
                      onChange={(e) => setNamaDapurInput(e.target.value)}
                      placeholder="Masukkan nama dapur"
                      className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-slate-800"
                      required
                    />
                  </label>

                  <label className="block">
                    <span className="block text-[10px] font-bold text-slate-500 mb-1">Alamat Lengkap</span>
                    <textarea
                      value={alamat}
                      onChange={(e) => setAlamat(e.target.value)}
                      placeholder="Masukkan alamat lengkap dapur"
                      rows="2"
                      className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-slate-800"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-[10px] font-bold text-slate-500 mb-1">Alamat Email</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="contoh@gmail.com"
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-slate-800"
                      />
                    </label>

                    <label className="block">
                      <span className="block text-[10px] font-bold text-slate-500 mb-1">No. WhatsApp</span>
                      <input
                        type="tel"
                        value={noWa}
                        onChange={(e) => setNoWa(e.target.value)}
                        placeholder="Contoh: 08565517191"
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-slate-800"
                      />
                    </label>
                  </div>
                </div>

                {profileError && (
                  <div className="bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 flex items-start gap-2">
                    <span className="text-rose-600 text-xs">⚠️</span>
                    <p className="text-[10px] text-rose-600 font-bold">{profileError}</p>
                  </div>
                )}

                {profileSuccess && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 flex items-start gap-2">
                    <span className="text-emerald-600 text-xs">✓</span>
                    <p className="text-[10px] text-emerald-600 font-bold">{profileSuccess}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-slate-900 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-60 text-white text-xs font-black uppercase tracking-wider rounded-lg py-2.5 transition-all"
                >
                  {isLoading ? 'Menyimpan...' : 'Simpan Profil'}
                </button>
              </form>

              <form onSubmit={handleChangePassword} className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm space-y-4">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400">Ubah Password Login</h3>
                  <p className="text-[10px] text-slate-400 mt-1">Ubah password default Anda agar keamanan data dapur tetap terjaga.</p>
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Password Baru</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordChangeError(''); }}
                      placeholder="Minimal 4 karakter"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-white"
                      required
                    />
                  </label>

                  <label className="block">
                    <span className="block text-[9px] font-bold text-slate-400 mb-1">Konfirmasi Password Baru</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setPasswordChangeError(''); }}
                      placeholder="Ulangi password baru"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs outline-none focus:border-emerald-500 text-white"
                      required
                    />
                  </label>
                </div>

                {passwordChangeError && (
                  <div className="bg-rose-950/40 border border-rose-900/30 rounded-xl px-3 py-2 flex items-start gap-2">
                    <span className="text-rose-400 text-xs">⚠️</span>
                    <p className="text-[10px] text-rose-400 font-bold">{passwordChangeError}</p>
                  </div>
                )}

                {passwordChangeSuccess && (
                  <div className="bg-emerald-950/40 border border-emerald-900/30 rounded-xl px-3 py-2 flex items-start gap-2">
                    <span className="text-emerald-400 text-xs">✓</span>
                    <p className="text-[10px] text-emerald-400 font-bold">{passwordChangeSuccess}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !newPassword || !confirmPassword}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-60 text-white text-xs font-black uppercase tracking-wider rounded-lg py-2.5 mt-2 transition-all"
                >
                  {isLoading ? 'Menyimpan...' : 'Simpan Password Baru'}
                </button>
              </form>
            </section>
          )}
        </main>

        <nav className="bg-white border-t border-slate-200 px-2 py-3 grid grid-cols-5 gap-1.5">
          <NavButton active={currentPage === 'beranda'} label="RAB" onClick={() => setCurrentPage('beranda')} />
          <NavButton active={currentPage === 'laporan'} label="Input" onClick={() => setCurrentPage('laporan')} />
          <NavButton active={currentPage === 'review'} label="Kirim Laporan" onClick={() => setCurrentPage('review')} />
          <NavButton active={currentPage === 'gudang'} label="Gudang" onClick={() => setCurrentPage('gudang')} />
          <NavButton active={currentPage === 'kulakan'} label="Pre Order" onClick={() => setCurrentPage('kulakan')} />
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
