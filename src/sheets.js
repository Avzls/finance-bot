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

const SHEET_NAME = 'Sheet1';
const RANGE_ALL = `${SHEET_NAME}!A:H`;

// ─── Inisialisasi Header ────────────────────────────────────────────
async function initializeSheet() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  // Cek apakah sudah ada data
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:H1`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    // Tulis header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Tanggal', 'Waktu', 'User ID', 'Username', 'Tipe', 'Jumlah', 'Keterangan', 'Saldo Kumulatif']],
      },
    });
    console.log('✅ Header sheet berhasil dibuat.');
  }
}

// ─── Ambil Saldo Terakhir ───────────────────────────────────────────
async function getLastSaldo() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) {
    // Belum ada transaksi, saldo = 0
    return 0;
  }

  const lastRow = rows[rows.length - 1];
  const saldo = parseFloat(lastRow[7]) || 0; // Kolom H = Saldo Kumulatif
  return saldo;
}

// ─── Tambah Transaksi ───────────────────────────────────────────────
async function appendTransaction({ userId, username, tipe, jumlah, keterangan }) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  // Ambil saldo terakhir
  const lastSaldo = await getLastSaldo();

  // Hitung saldo baru
  let saldoBaru;
  if (tipe === 'MASUK') {
    saldoBaru = lastSaldo + jumlah;
  } else {
    saldoBaru = lastSaldo - jumlah;
  }

  // Format tanggal & waktu (WIB / UTC+7)
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const tanggal = wib.toISOString().split('T')[0]; // YYYY-MM-DD
  const waktu = wib.toISOString().split('T')[1].substring(0, 8); // HH:MM:SS

  const row = [
    tanggal,
    waktu,
    String(userId),
    username || '-',
    tipe,
    jumlah,
    keterangan,
    saldoBaru,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: RANGE_ALL,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  return { saldoBaru, tanggal, waktu };
}

// ─── Laporan Bulanan ────────────────────────────────────────────────
async function getMonthlyReport(year, month) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) {
    return { totalMasuk: 0, totalKeluar: 0, saldo: 0, jumlahTransaksi: 0 };
  }

  // Filter bulan dan tahun (kolom A = Tanggal format YYYY-MM-DD)
  const monthStr = String(month).padStart(2, '0');
  const prefix = `${year}-${monthStr}`;

  let totalMasuk = 0;
  let totalKeluar = 0;
  let jumlahTransaksi = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tanggal = row[0] || '';
    if (!tanggal.startsWith(prefix)) continue;

    jumlahTransaksi++;
    const tipe = row[4];
    const jumlah = parseFloat(row[5]) || 0;

    if (tipe === 'MASUK') {
      totalMasuk += jumlah;
    } else if (tipe === 'KELUAR') {
      totalKeluar += jumlah;
    }
  }

  // Ambil saldo terkini dari baris terakhir
  const lastRow = rows[rows.length - 1];
  const saldo = parseFloat(lastRow[7]) || 0;

  return { totalMasuk, totalKeluar, saldo, jumlahTransaksi };
}

// ─── Riwayat Transaksi Terakhir ─────────────────────────────────────
async function getRecentTransactions(count = 10) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) {
    return [];
  }

  // Ambil N baris terakhir (skip header)
  const dataRows = rows.slice(1);
  const recent = dataRows.slice(-count);

  return recent.map((row) => ({
    tanggal: row[0] || '-',
    waktu: row[1] || '-',
    tipe: row[4] || '-',
    jumlah: parseFloat(row[5]) || 0,
    keterangan: row[6] || '-',
    saldo: parseFloat(row[7]) || 0,
  }));
}

// ─── Hitung Ulang Saldo Kumulatif ───────────────────────────────────
async function recalculateSaldo() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) return;

  let saldo = 0;
  const updates = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tipe = row[4];
    const jumlah = parseFloat(row[5]) || 0;

    if (tipe === 'MASUK') {
      saldo += jumlah;
    } else if (tipe === 'KELUAR') {
      saldo -= jumlah;
    }

    updates.push([saldo]);
  }

  // Update kolom H (Saldo Kumulatif) untuk semua baris data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!H2:H${rows.length}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: updates,
    },
  });
}

// ─── Hapus Transaksi Terakhir ───────────────────────────────────────
async function deleteLastTransaction() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) {
    return null; // Tidak ada transaksi
  }

  const lastRow = rows[rows.length - 1];
  const deleted = {
    tanggal: lastRow[0],
    waktu: lastRow[1],
    tipe: lastRow[4],
    jumlah: parseFloat(lastRow[5]) || 0,
    keterangan: lastRow[6],
  };

  // Hapus baris terakhir menggunakan batchUpdate
  // Pertama, dapatkan sheetId (biasanya 0 untuk Sheet1)
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  const sheetIdNum = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetIdNum,
              dimension: 'ROWS',
              startIndex: rows.length - 1, // 0-indexed
              endIndex: rows.length,
            },
          },
        },
      ],
    },
  });

  return deleted;
}

// ─── Edit Transaksi Terakhir ────────────────────────────────────────
async function editLastTransaction({ jumlah, keterangan, tipe }) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) {
    return null;
  }

  const lastRowIndex = rows.length; // 1-indexed untuk Sheets API
  const lastRow = rows[rows.length - 1];

  const oldData = {
    tipe: lastRow[4],
    jumlah: parseFloat(lastRow[5]) || 0,
    keterangan: lastRow[6],
  };

  // Update field yang diberikan
  const newTipe = tipe || lastRow[4];
  const newJumlah = jumlah !== undefined ? jumlah : parseFloat(lastRow[5]) || 0;
  const newKeterangan = keterangan !== undefined ? keterangan : lastRow[6];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!E${lastRowIndex}:G${lastRowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[newTipe, newJumlah, newKeterangan]],
    },
  });

  // Hitung ulang saldo kumulatif
  await recalculateSaldo();

  const newSaldo = await getLastSaldo();

  return {
    old: oldData,
    new: { tipe: newTipe, jumlah: newJumlah, keterangan: newKeterangan },
    saldoBaru: newSaldo,
  };
}

// ─── Ambil Semua Transaksi (untuk export) ───────────────────────────
async function getAllTransactions() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) return [];

  return rows.slice(1).map((row) => ({
    tanggal: row[0] || '',
    waktu: row[1] || '',
    userId: row[2] || '',
    username: row[3] || '',
    tipe: row[4] || '',
    jumlah: parseFloat(row[5]) || 0,
    keterangan: row[6] || '',
    saldo: parseFloat(row[7]) || 0,
  }));
}

// ─── Data Bulanan untuk Grafik (semua bulan dari awal) ──────────────
async function getMonthlyBreakdown() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) return [];

  // Kumpulkan data per bulan dari semua transaksi
  const monthlyMap = {};
  const namaBulan = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  for (let i = 1; i < rows.length; i++) {
    const tanggal = rows[i][0] || '';
    if (!tanggal) continue;

    const prefix = tanggal.substring(0, 7); // YYYY-MM
    if (!monthlyMap[prefix]) {
      monthlyMap[prefix] = { totalMasuk: 0, totalKeluar: 0 };
    }

    const tipe = rows[i][4];
    const jumlah = parseFloat(rows[i][5]) || 0;
    if (tipe === 'MASUK') monthlyMap[prefix].totalMasuk += jumlah;
    else if (tipe === 'KELUAR') monthlyMap[prefix].totalKeluar += jumlah;
  }

  // Urutkan berdasarkan bulan dan konversi ke array
  const sortedKeys = Object.keys(monthlyMap).sort();
  return sortedKeys.map((key) => {
    const [y, m] = key.split('-');
    return {
      label: `${namaBulan[parseInt(m)]} ${y}`,
      totalMasuk: monthlyMap[key].totalMasuk,
      totalKeluar: monthlyMap[key].totalKeluar,
    };
  });
}

// ─── Reset Semua Data ───────────────────────────────────────────────
async function resetAllData() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) return 0;

  const count = rows.length - 1; // Jumlah baris data (tanpa header)

  // Hapus semua baris data (bukan header)
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  const sheetIdNum = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetIdNum,
              dimension: 'ROWS',
              startIndex: 1, // Mulai setelah header
              endIndex: rows.length,
            },
          },
        },
      ],
    },
  });

  return count;
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
};


