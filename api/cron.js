require('dotenv').config();
const { Telegraf } = require('telegraf');
const sheets = require('../src/sheets');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

function formatRupiah(num) {
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

module.exports = async (req, res) => {
  try {
    // Verifikasi cron secret (opsional, untuk keamanan)
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const tanggal = wib.getDate();
    const jam = wib.getHours();

    const results = { notif: 0, cicilan: 0 };

    // ─── Proses cicilan setiap tanggal 1 ────────────────────────────
    if (tanggal === 1) {
      const processed = await sheets.processAllCicilan();
      results.cicilan = processed.length;

      // Kirim notifikasi ke masing-masing user
      for (const item of processed) {
        try {
          await bot.telegram.sendMessage(
            item.chatId,
            `🔄 *Cicilan Otomatis Tercatat*\n\n` +
            `💸 ${formatRupiah(item.jumlah)} — ${item.keterangan}\n` +
            `📅 Sisa: ${item.sisaBulan}/${item.totalBulan} bulan` +
            (item.sisaBulan === 0 ? '\n\n✅ Cicilan ini sudah *LUNAS*! 🎉' : ''),
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          console.error(`Gagal kirim notif cicilan ke ${item.chatId}:`, err.message);
        }
      }
    }

    // ─── Kirim pengingat harian ─────────────────────────────────────
    const subscribers = await sheets.getActiveSubscribers();
    results.notif = subscribers.length;

    const tips = [
      'Jangan lupa catat pengeluaran hari ini! 📝',
      'Sudah catat semua transaksi hari ini? 🤔',
      'Yuk disiplin catat keuangan! 💪',
      'Belum catat pengeluaran? Ketik /keluar sekarang! ✍️',
      'Keuangan rapi = hidup tenang 😌',
      'Catat dulu, baru tidur! 🌙',
    ];
    const tip = tips[Math.floor(Math.random() * tips.length)];

    for (const sub of subscribers) {
      try {
        await bot.telegram.sendMessage(
          sub.chatId,
          `🔔 *Pengingat Keuangan*\n\n${tip}\n\nKetik /laporan untuk cek ringkasan bulan ini.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error(`Gagal kirim notif ke ${sub.chatId}:`, err.message);
      }
    }

    res.status(200).json({
      ok: true,
      time: wib.toISOString(),
      results,
    });
  } catch (error) {
    console.error('Cron error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
