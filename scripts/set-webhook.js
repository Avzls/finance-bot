/**
 * Script untuk mengatur webhook Telegram.
 *
 * Cara pakai:
 *   node scripts/set-webhook.js https://nama-app.vercel.app
 *
 * Untuk menghapus webhook (kembali ke polling mode):
 *   node scripts/set-webhook.js delete
 */

require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const args = process.argv.slice(2);

if (!TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_TOKEN belum diatur di .env');
  process.exit(1);
}

if (args.length === 0) {
  console.log('Cara pakai:');
  console.log('  Set webhook:    node scripts/set-webhook.js https://nama-app.vercel.app');
  console.log('  Hapus webhook:  node scripts/set-webhook.js delete');
  process.exit(0);
}

async function main() {
  const input = args[0];

  let url;
  if (input === 'delete') {
    url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook`;
    console.log('🗑️  Menghapus webhook...');
  } else {
    const webhookUrl = `${input.replace(/\/$/, '')}/api/webhook`;
    url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    console.log(`🔗 Mengatur webhook ke: ${webhookUrl}`);
  }

  const res = await fetch(url);
  const data = await res.json();

  if (data.ok) {
    console.log('✅', data.description);
  } else {
    console.error('❌', data.description);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
