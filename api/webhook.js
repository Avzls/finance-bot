require('dotenv').config();
const bot = require('../src/bot');
const sheets = require('../src/sheets');

// Pastikan header sheet sudah ada
let initialized = false;

module.exports = async (req, res) => {
  try {
    // Inisialisasi sheet sekali saja
    if (!initialized) {
      await sheets.migrateFromSheet1();
      await sheets.initializeSheet();
      initialized = true;
    }

    // Hanya terima POST request dari Telegram
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ status: 'Bot is running! 🤖' });
    }
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
