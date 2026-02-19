const { google } = require('googleapis');

// ─── Autentikasi Google Sheets API ──────────────────────────────────
let sheetsClient = null;

function getAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function getSheets() {
  if (!sheetsClient) {
    const auth = getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

function getSheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

const NAMA_BULAN = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

const HEADERS = ['Tanggal', 'Waktu', 'User ID', 'Username', 'Tipe', 'Jumlah', 'Keterangan', 'Saldo Kumulatif'];

// ─── Helper: Parse angka dari Google Sheets (bisa Rp10.000 atau 10000)
function parseNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[Rp\s.]/g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

// ─── Helper: Nama sheet untuk bulan tertentu ────────────────────────
function getMonthSheetName(year, month) {
  return `${NAMA_BULAN[month]} ${year}`;
}

// ─── Helper: Nama sheet bulan ini (WIB) ─────────────────────────────
function getCurrentMonthSheet() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return getMonthSheetName(wib.getFullYear(), wib.getMonth() + 1);
}

// ─── Helper: Daftar semua sheet yang ada ────────────────────────────
async function getAllSheetNames() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  return spreadsheet.data.sheets.map((s) => s.properties.title);
}

// ─── Helper: Daftar sheet bulanan, diurutkan kronologis ─────────────
async function getMonthlySheetNames() {
  const allNames = await getAllSheetNames();

  // Filter hanya sheet dengan format "Xxx YYYY"
  const monthlySheets = allNames.filter((name) => {
    const parts = name.split(' ');
    if (parts.length !== 2) return false;
    return NAMA_BULAN.includes(parts[0]) && !isNaN(parseInt(parts[1]));
  });

  // Urutkan kronologis
  monthlySheets.sort((a, b) => {
    const [ma, ya] = a.split(' ');
    const [mb, yb] = b.split(' ');
    const da = parseInt(ya) * 100 + NAMA_BULAN.indexOf(ma);
    const db = parseInt(yb) * 100 + NAMA_BULAN.indexOf(mb);
    return da - db;
  });

  return monthlySheets;
}

// ─── Pastikan sheet bulan ini ada ───────────────────────────────────
async function ensureMonthSheet(sheetName) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const allNames = await getAllSheetNames();
  if (allNames.includes(sheetName)) return;

  // Buat sheet baru
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });

  // Tulis header
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:H1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [HEADERS],
    },
  });

  console.log(`✅ Sheet "${sheetName}" berhasil dibuat.`);
}

// ─── Inisialisasi (buat sheet bulan ini jika belum ada) ─────────────
async function initializeSheet() {
  const sheetName = getCurrentMonthSheet();
  await ensureMonthSheet(sheetName);
}

// ─── Ambil Saldo Terakhir dari sheet tertentu ───────────────────────
async function getSheetLastSaldo(sheetName) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:H`,
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null; // Tidak ada data

    const lastRow = rows[rows.length - 1];
    return parseNum(lastRow[7]);
  } catch {
    return null;
  }
}

// ─── Ambil Saldo Terakhir (global, dari sheet terbaru) ──────────────
async function getLastSaldo() {
  const monthlySheets = await getMonthlySheetNames();

  // Cek dari sheet terbaru ke terlama
  for (let i = monthlySheets.length - 1; i >= 0; i--) {
    const saldo = await getSheetLastSaldo(monthlySheets[i]);
    if (saldo !== null) return saldo;
  }

  return 0;
}

// ─── Tambah Transaksi ───────────────────────────────────────────────
async function appendTransaction({ userId, username, tipe, jumlah, keterangan }) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const sheetName = getCurrentMonthSheet();
  await ensureMonthSheet(sheetName);

  // Ambil saldo terakhir (dari sheet ini, atau bulan sebelumnya)
  const lastSaldo = await getLastSaldo();
  const saldoBaru = tipe === 'MASUK' ? lastSaldo + jumlah : lastSaldo - jumlah;

  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const tanggal = wib.toISOString().split('T')[0];
  const waktu = wib.toISOString().split('T')[1].substring(0, 8);

  const row = [tanggal, waktu, String(userId), username || '-', tipe, jumlah, keterangan, saldoBaru];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  return { saldoBaru, tanggal, waktu };
}

// ─── Laporan Bulanan ────────────────────────────────────────────────
async function getMonthlyReport(year, month) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const sheetName = getMonthSheetName(year, month);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:H`,
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) {
      return { totalMasuk: 0, totalKeluar: 0, saldo: 0, jumlahTransaksi: 0 };
    }

    let totalMasuk = 0;
    let totalKeluar = 0;

    for (let i = 1; i < rows.length; i++) {
      const tipe = rows[i][4];
      const jumlah = parseNum(rows[i][5]);
      if (tipe === 'MASUK') totalMasuk += jumlah;
      else if (tipe === 'KELUAR') totalKeluar += jumlah;
    }

    const lastRow = rows[rows.length - 1];
    const saldo = parseNum(lastRow[7]);

    return { totalMasuk, totalKeluar, saldo, jumlahTransaksi: rows.length - 1 };
  } catch {
    return { totalMasuk: 0, totalKeluar: 0, saldo: 0, jumlahTransaksi: 0 };
  }
}

// ─── Riwayat Transaksi Terakhir ─────────────────────────────────────
async function getRecentTransactions(count = 10) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const monthlySheets = await getMonthlySheetNames();

  let all = [];

  // Baca dari sheet terbaru ke terlama sampai cukup
  for (let i = monthlySheets.length - 1; i >= 0 && all.length < count; i--) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${monthlySheets[i]}'!A:H`,
      });

      const rows = res.data.values;
      if (!rows || rows.length <= 1) continue;

      const dataRows = rows.slice(1).map((row) => ({
        tanggal: row[0] || '-',
        waktu: row[1] || '-',
        tipe: row[4] || '-',
        jumlah: parseNum(row[5]),
        keterangan: row[6] || '-',
        saldo: parseNum(row[7]),
      }));

      all = dataRows.concat(all);
    } catch {
      continue;
    }
  }

  return all.slice(-count);
}

// ─── Hitung Ulang Saldo Kumulatif (untuk sheet tertentu) ────────────
async function recalculateSaldo(sheetName, startingSaldo = 0) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:H`,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) return;

  let saldo = startingSaldo;
  const updates = [];

  for (let i = 1; i < rows.length; i++) {
    const tipe = rows[i][4];
    const jumlah = parseNum(rows[i][5]);
    if (tipe === 'MASUK') saldo += jumlah;
    else if (tipe === 'KELUAR') saldo -= jumlah;
    updates.push([saldo]);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!H2:H${rows.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: updates },
  });
}

// ─── Helper: Saldo akhir bulan sebelumnya ───────────────────────────
async function getPreviousMonthEndingSaldo(currentSheetName) {
  const monthlySheets = await getMonthlySheetNames();
  const idx = monthlySheets.indexOf(currentSheetName);
  if (idx <= 0) return 0;

  const prevSheet = monthlySheets[idx - 1];
  const saldo = await getSheetLastSaldo(prevSheet);
  return saldo || 0;
}

// ─── Hapus Transaksi Terakhir ───────────────────────────────────────
async function deleteLastTransaction() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const sheetName = getCurrentMonthSheet();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:H`,
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null;

    const lastRow = rows[rows.length - 1];
    const deleted = {
      tanggal: lastRow[0],
      waktu: lastRow[1],
      tipe: lastRow[4],
      jumlah: parseNum(lastRow[5]),
      keterangan: lastRow[6],
    };

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets.find((s) => s.properties.title === sheetName);
    const sheetIdNum = sheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetIdNum,
              dimension: 'ROWS',
              startIndex: rows.length - 1,
              endIndex: rows.length,
            },
          },
        }],
      },
    });

    // Recalculate saldo for this month
    const startingSaldo = await getPreviousMonthEndingSaldo(sheetName);
    await recalculateSaldo(sheetName, startingSaldo);

    return deleted;
  } catch {
    return null;
  }
}

// ─── Edit Transaksi Terakhir ────────────────────────────────────────
async function editLastTransaction({ jumlah, keterangan, tipe }) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const sheetName = getCurrentMonthSheet();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:H`,
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null;

    const lastRowIndex = rows.length;
    const lastRow = rows[rows.length - 1];

    const oldData = {
      tipe: lastRow[4],
      jumlah: parseNum(lastRow[5]),
      keterangan: lastRow[6],
    };

    const newTipe = tipe || lastRow[4];
    const newJumlah = jumlah !== undefined ? jumlah : parseNum(lastRow[5]);
    const newKeterangan = keterangan !== undefined ? keterangan : lastRow[6];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!E${lastRowIndex}:G${lastRowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[newTipe, newJumlah, newKeterangan]] },
    });

    const startingSaldo = await getPreviousMonthEndingSaldo(sheetName);
    await recalculateSaldo(sheetName, startingSaldo);

    const newSaldo = await getLastSaldo();

    return {
      old: oldData,
      new: { tipe: newTipe, jumlah: newJumlah, keterangan: newKeterangan },
      saldoBaru: newSaldo,
    };
  } catch {
    return null;
  }
}

// ─── Ambil Semua Transaksi (untuk export) ───────────────────────────
async function getAllTransactions() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const monthlySheets = await getMonthlySheetNames();

  let all = [];

  for (const sheetName of monthlySheets) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A:H`,
      });

      const rows = res.data.values;
      if (!rows || rows.length <= 1) continue;

      const dataRows = rows.slice(1).map((row) => ({
        tanggal: row[0] || '',
        waktu: row[1] || '',
        userId: row[2] || '',
        username: row[3] || '',
        tipe: row[4] || '',
        jumlah: parseNum(row[5]),
        keterangan: row[6] || '',
        saldo: parseNum(row[7]),
      }));

      all = all.concat(dataRows);
    } catch {
      continue;
    }
  }

  return all;
}

// ─── Data Bulanan untuk Grafik (semua bulan dari awal) ──────────────
async function getMonthlyBreakdown() {
  const monthlySheets = await getMonthlySheetNames();
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const result = [];

  for (const sheetName of monthlySheets) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A:H`,
      });

      const rows = res.data.values;
      let totalMasuk = 0;
      let totalKeluar = 0;

      if (rows && rows.length > 1) {
        for (let i = 1; i < rows.length; i++) {
          const tipe = rows[i][4];
          const jumlah = parseNum(rows[i][5]);
          if (tipe === 'MASUK') totalMasuk += jumlah;
          else if (tipe === 'KELUAR') totalKeluar += jumlah;
        }
      }

      result.push({ label: sheetName, totalMasuk, totalKeluar });
    } catch {
      continue;
    }
  }

  return result;
}

// ─── Reset Semua Data ───────────────────────────────────────────────
async function resetAllData() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const monthlySheets = await getMonthlySheetNames();

  if (monthlySheets.length === 0) return 0;

  let totalCount = 0;

  // Hitung total transaksi dan hapus semua sheet bulanan
  // Tapi simpan sheet pertama (ganti jadi sheet bulan ini yang kosong)
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = spreadsheet.data.sheets;

  // Pastikan selalu ada minimal 1 sheet — buat sheet temporary jika perlu
  const tempName = '__temp__';
  let needsTemp = true;
  for (const s of allSheets) {
    if (!monthlySheets.includes(s.properties.title)) {
      needsTemp = false;
      break;
    }
  }

  if (needsTemp) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tempName } } }],
      },
    });
  }

  // Hapus semua sheet bulanan
  const requests = [];
  for (const s of allSheets) {
    if (monthlySheets.includes(s.properties.title)) {
      // Hitung transaksi
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${s.properties.title}'!A:A`,
        });
        if (res.data.values) totalCount += Math.max(0, res.data.values.length - 1);
      } catch { /* skip */ }

      requests.push({ deleteSheet: { sheetId: s.properties.sheetId } });
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  // Hapus temp sheet jika dibuat
  if (needsTemp) {
    const updated = await sheets.spreadsheets.get({ spreadsheetId });
    const tempSheet = updated.data.sheets.find((s) => s.properties.title === tempName);
    if (tempSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: tempSheet.properties.sheetId } }],
        },
      });
    }
  }

  return totalCount;
}

// ─── Migrasi: Pindahkan data dari Sheet1 ke sheet bulanan ───────────
async function migrateFromSheet1() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const allNames = await getAllSheetNames();
  if (!allNames.includes('Sheet1')) return false;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Sheet1'!A:H`,
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return false;

    // Kelompokkan per bulan
    const monthGroups = {};
    for (let i = 1; i < rows.length; i++) {
      const tanggal = rows[i][0] || '';
      if (!tanggal) continue;

      const [year, monthStr] = tanggal.split('-');
      const month = parseInt(monthStr);
      const sheetName = getMonthSheetName(parseInt(year), month);

      if (!monthGroups[sheetName]) monthGroups[sheetName] = [];
      monthGroups[sheetName].push(rows[i]);
    }

    // Buat sheet per bulan dan pindahkan data
    for (const [sheetName, dataRows] of Object.entries(monthGroups)) {
      await ensureMonthSheet(sheetName);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A:H`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: dataRows },
      });

      // Recalculate saldo
      const prevSaldo = await getPreviousMonthEndingSaldo(sheetName);
      await recalculateSaldo(sheetName, prevSaldo);
    }

    // Hapus Sheet1
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet1 = spreadsheet.data.sheets.find((s) => s.properties.title === 'Sheet1');
    if (sheet1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }],
        },
      });
    }

    console.log(`✅ Migrasi selesai: ${Object.keys(monthGroups).length} sheet bulanan dibuat.`);
    return true;
  } catch (error) {
    console.error('Error migrasi:', error.message);
    return false;
  }
}

module.exports = {
  initializeSheet,
  appendTransaction,
  getLastSaldo,
  getMonthlyReport,
  getRecentTransactions,
  deleteLastTransaction,
  editLastTransaction,
  recalculateSaldo,
  getAllTransactions,
  getMonthlyBreakdown,
  resetAllData,
  migrateFromSheet1,
};
