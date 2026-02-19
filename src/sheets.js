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

module.exports = {
  initializeSheet,
  appendTransaction,
  getLastSaldo,
  getMonthlyReport,
  getRecentTransactions,
};
