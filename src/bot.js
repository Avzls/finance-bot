require('dotenv').config();

const { Telegraf } = require('telegraf');
const sheets = require('./sheets');

// ─── Validasi Environment Variables ─────────────────────────────────
const requiredEnv = ['TELEGRAM_TOKEN', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Environment variable ${key} belum diatur!`);
    process.exit(1);
  }
}

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ─── Helper: Format angka ke Rupiah ─────────────────────────────────
function formatRupiah(angka) {
  return 'Rp ' + Number(angka).toLocaleString('id-ID');
}

// ─── /start ─────────────────────────────────────────────────────────
bot.start((ctx) => {
  const name = ctx.from.first_name || 'Kamu';
  ctx.reply(
    `👋 Halo, ${name}!\n\n` +
    `Saya adalah *Bot Pencatatan Keuangan* 💰\n\n` +
    `Saya akan membantu kamu mencatat pemasukan dan pengeluaran langsung ke Google Sheets.\n\n` +
    `Ketik /help untuk melihat panduan penggunaan.`,
    { parse_mode: 'Markdown' }
  );
});

// ─── /help ──────────────────────────────────────────────────────────
bot.help((ctx) => {
  ctx.reply(
    `📖 *Panduan Penggunaan Bot*\n\n` +
    `💵 *Catat Pemasukan:*\n` +
    `/masuk <jumlah> <keterangan>\n` +
    `Contoh: \`/masuk 500000 Gaji bulanan\`\n\n` +
    `💸 *Catat Pengeluaran:*\n` +
    `/keluar <jumlah> <keterangan>\n` +
    `Contoh: \`/keluar 50000 Makan siang\`\n\n` +
    `📊 *Laporan Bulan Ini:*\n` +
    `/laporan\n\n` +
    `📋 *10 Transaksi Terakhir:*\n` +
    `/riwayat\n\n` +
    `💡 *Tips:* Jumlah harus berupa angka tanpa titik atau koma.\n` +
    `Contoh: 500000 ✅ | 500.000 ❌`,
    { parse_mode: 'Markdown' }
  );
});

// ─── /masuk <jumlah> <keterangan> ───────────────────────────────────
bot.command('masuk', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply(
        '⚠️ Format salah!\n\n' +
        'Gunakan: `/masuk <jumlah> <keterangan>`\n' +
        'Contoh: `/masuk 500000 Gaji bulanan`',
        { parse_mode: 'Markdown' }
      );
    }

    const jumlah = parseFloat(args[0]);
    if (isNaN(jumlah) || jumlah <= 0) {
      return ctx.reply('⚠️ Jumlah harus berupa angka positif!\n\nContoh: `/masuk 500000 Gaji bulanan`', { parse_mode: 'Markdown' });
    }

    const keterangan = args.slice(1).join(' ');

    const result = await sheets.appendTransaction({
      userId: ctx.from.id,
      username: ctx.from.username || ctx.from.first_name || '-',
      tipe: 'MASUK',
      jumlah,
      keterangan,
    });

    ctx.reply(
      `✅ *Pemasukan berhasil dicatat!*\n\n` +
      `📅 Tanggal: ${result.tanggal}\n` +
      `🕐 Waktu: ${result.waktu} WIB\n` +
      `💵 Jumlah: ${formatRupiah(jumlah)}\n` +
      `📝 Keterangan: ${keterangan}\n` +
      `💰 Saldo: ${formatRupiah(result.saldoBaru)}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /masuk:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat mencatat pemasukan. Silakan coba lagi nanti.');
  }
});

// ─── /keluar <jumlah> <keterangan> ──────────────────────────────────
bot.command('keluar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply(
        '⚠️ Format salah!\n\n' +
        'Gunakan: `/keluar <jumlah> <keterangan>`\n' +
        'Contoh: `/keluar 50000 Makan siang`',
        { parse_mode: 'Markdown' }
      );
    }

    const jumlah = parseFloat(args[0]);
    if (isNaN(jumlah) || jumlah <= 0) {
      return ctx.reply('⚠️ Jumlah harus berupa angka positif!\n\nContoh: `/keluar 50000 Makan siang`', { parse_mode: 'Markdown' });
    }

    const keterangan = args.slice(1).join(' ');

    const result = await sheets.appendTransaction({
      userId: ctx.from.id,
      username: ctx.from.username || ctx.from.first_name || '-',
      tipe: 'KELUAR',
      jumlah,
      keterangan,
    });

    ctx.reply(
      `✅ *Pengeluaran berhasil dicatat!*\n\n` +
      `📅 Tanggal: ${result.tanggal}\n` +
      `🕐 Waktu: ${result.waktu} WIB\n` +
      `💸 Jumlah: ${formatRupiah(jumlah)}\n` +
      `📝 Keterangan: ${keterangan}\n` +
      `💰 Saldo: ${formatRupiah(result.saldoBaru)}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /keluar:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat mencatat pengeluaran. Silakan coba lagi nanti.');
  }
});

// ─── /laporan ───────────────────────────────────────────────────────
bot.command('laporan', async (ctx) => {
  try {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const year = wib.getFullYear();
    const month = wib.getMonth() + 1;

    const namaBulan = [
      '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ];

    const report = await sheets.getMonthlyReport(year, month);

    if (report.jumlahTransaksi === 0) {
      return ctx.reply(`📊 Belum ada transaksi di bulan ${namaBulan[month]} ${year}.`);
    }

    const selisih = report.totalMasuk - report.totalKeluar;

    ctx.reply(
      `📊 *Laporan Keuangan*\n` +
      `📅 ${namaBulan[month]} ${year}\n\n` +
      `💵 Total Pemasukan: ${formatRupiah(report.totalMasuk)}\n` +
      `💸 Total Pengeluaran: ${formatRupiah(report.totalKeluar)}\n` +
      `${selisih >= 0 ? '📈' : '📉'} Selisih Bulan Ini: ${formatRupiah(selisih)}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 *Saldo Saat Ini: ${formatRupiah(report.saldo)}*\n\n` +
      `📋 Total Transaksi: ${report.jumlahTransaksi} transaksi`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /laporan:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat mengambil laporan. Silakan coba lagi nanti.');
  }
});

// ─── /riwayat ───────────────────────────────────────────────────────
bot.command('riwayat', async (ctx) => {
  try {
    const transactions = await sheets.getRecentTransactions(10);

    if (transactions.length === 0) {
      return ctx.reply('📋 Belum ada transaksi yang tercatat.');
    }

    let message = '📋 *10 Transaksi Terakhir:*\n\n';

    transactions.forEach((tx, index) => {
      const emoji = tx.tipe === 'MASUK' ? '💵' : '💸';
      const sign = tx.tipe === 'MASUK' ? '+' : '-';
      message += `${index + 1}. ${emoji} ${tx.tanggal} ${tx.waktu}\n`;
      message += `    ${sign}${formatRupiah(tx.jumlah)} — ${tx.keterangan}\n`;
      message += `    Saldo: ${formatRupiah(tx.saldo)}\n\n`;
    });

    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /riwayat:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat mengambil riwayat. Silakan coba lagi nanti.');
  }
});

// ─── Pesan tidak dikenali (hanya di private chat) ───────────────────
bot.on('text', (ctx) => {
  // Di grup, abaikan pesan biasa agar tidak mengganggu
  if (ctx.chat.type !== 'private') return;

  ctx.reply(
    '🤔 Perintah tidak dikenali.\n\nKetik /help untuk melihat daftar perintah yang tersedia.'
  );
});

// ─── Start Bot ──────────────────────────────────────────────────────
async function main() {
  try {
    // Inisialisasi header sheet jika belum ada
    await sheets.initializeSheet();
    console.log('✅ Koneksi Google Sheets berhasil.');

    // Jalankan bot
    await bot.launch();
    console.log('🤖 Bot berhasil berjalan!');
  } catch (error) {
    console.error('❌ Gagal menjalankan bot:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

main();
