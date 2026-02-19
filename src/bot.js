require('dotenv').config();

const { Telegraf } = require('telegraf');
const PDFDocument = require('pdfkit');
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

// ─── Helper: Parse jumlah (support format 10.000 dan 10000) ─────────
function parseJumlah(str) {
  // Hapus titik pemisah ribuan, lalu parse
  const cleaned = str.replace(/\./g, '');
  return parseFloat(cleaned);
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
    `💵 /masuk \`<jumlah> <keterangan>\`\n` +
    `💸 /keluar \`<jumlah> <keterangan>\`\n` +
    `📊 /laporan — Ringkasan bulan ini\n` +
    `📅 /bulan \`<bulan> <tahun>\` — Laporan bulan tertentu\n` +
    `📋 /riwayat — 10 transaksi terakhir\n` +
    `✏️ /edit \`<jumlah> <keterangan>\` — Edit terakhir\n` +
    `🗑️ /hapus — Hapus transaksi terakhir\n` +
    `📈 /grafik — Grafik pemasukan vs pengeluaran\n` +
    `📁 /export — Export PDF\n` +
    `🔄 /reset — Hapus semua data\n` +
    `📦 /migrasi — Pindahkan data Sheet1 ke sheet bulanan\n\n` +
    `💡 *Tips:*\n` +
    `• Jumlah bisa pakai titik: \`50.000\` atau \`50000\`\n` +
    `• Bisa kirim beberapa perintah sekaligus (satu per baris)\n` +
    `• Contoh: \`/keluar 50.000 Makan siang\``,
    { parse_mode: 'Markdown' }
  );
});

// ─── Middleware: Batch multi-line commands ───────────────────────────
bot.use(async (ctx, next) => {
  if (!ctx.message || !ctx.message.text) return next();

  const text = ctx.message.text.trim();
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // Cek apakah ada lebih dari 1 baris yang dimulai dengan /masuk atau /keluar
  const commandLines = lines.filter((l) => /^\/(masuk|keluar)\s/i.test(l));
  if (commandLines.length <= 1) return next();

  // Proses batch
  try {
    const results = [];
    let hasError = false;

    for (const line of commandLines) {
      const parts = line.split(/\s+/);
      const cmd = parts[0].replace('/', '').toLowerCase().split('@')[0];
      const args = parts.slice(1);

      if (args.length < 2) {
        results.push(`⚠️ Format salah: \`${line}\``);
        hasError = true;
        continue;
      }

      const jumlah = parseJumlah(args[0]);
      if (isNaN(jumlah) || jumlah <= 0) {
        results.push(`⚠️ Jumlah tidak valid: \`${line}\``);
        hasError = true;
        continue;
      }

      const tipe = cmd === 'masuk' ? 'MASUK' : 'KELUAR';
      const keterangan = args.slice(1).join(' ');

      const result = await sheets.appendTransaction({
        userId: ctx.from.id,
        username: ctx.from.username || ctx.from.first_name || '-',
        tipe,
        jumlah,
        keterangan,
      });

      const emoji = tipe === 'MASUK' ? '💵' : '💸';
      results.push(`${emoji} ${tipe} ${formatRupiah(jumlah)} — ${keterangan}`);
    }

    // Ambil saldo terbaru
    const saldoAkhir = await sheets.getLastSaldo();

    let message = `✅ *${commandLines.length} transaksi berhasil dicatat!*\n\n`;
    results.forEach((r, i) => {
      message += `${i + 1}. ${r}\n`;
    });
    message += `\n💰 *Saldo: ${formatRupiah(saldoAkhir)}*`;

    return ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error batch:', error.message);
    return ctx.reply('❌ Terjadi kesalahan saat mencatat transaksi batch. Silakan coba lagi.');
  }
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

    const jumlah = parseJumlah(args[0]);
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

    const jumlah = parseJumlah(args[0]);
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

// ─── /hapus ──────────────────────────────────────────────────────────
bot.command('hapus', async (ctx) => {
  try {
    const deleted = await sheets.deleteLastTransaction();

    if (!deleted) {
      return ctx.reply('📋 Tidak ada transaksi yang bisa dihapus.');
    }

    const emoji = deleted.tipe === 'MASUK' ? '💵' : '💸';
    const saldo = await sheets.getLastSaldo();

    ctx.reply(
      `🗑️ *Transaksi terakhir berhasil dihapus!*\n\n` +
      `${emoji} ${deleted.tipe} ${formatRupiah(deleted.jumlah)}\n` +
      `📝 ${deleted.keterangan}\n` +
      `📅 ${deleted.tanggal} ${deleted.waktu}\n\n` +
      `💰 *Saldo: ${formatRupiah(saldo)}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /hapus:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat menghapus transaksi. Silakan coba lagi nanti.');
  }
});

// ─── /edit <jumlah> <keterangan> ────────────────────────────────────
bot.command('edit', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply(
        '⚠️ Format salah!\n\n' +
        'Gunakan: `/edit <jumlah_baru> <keterangan_baru>`\n' +
        'Contoh: `/edit 75000 Makan malam`',
        { parse_mode: 'Markdown' }
      );
    }

    const jumlah = parseJumlah(args[0]);
    if (isNaN(jumlah) || jumlah <= 0) {
      return ctx.reply('⚠️ Jumlah harus berupa angka positif!', { parse_mode: 'Markdown' });
    }

    const keterangan = args.slice(1).join(' ');

    const result = await sheets.editLastTransaction({ jumlah, keterangan });

    if (!result) {
      return ctx.reply('📋 Tidak ada transaksi yang bisa diedit.');
    }

    ctx.reply(
      `✏️ *Transaksi terakhir berhasil diedit!*\n\n` +
      `*Sebelum:*\n` +
      `${result.old.tipe} ${formatRupiah(result.old.jumlah)} — ${result.old.keterangan}\n\n` +
      `*Sesudah:*\n` +
      `${result.new.tipe} ${formatRupiah(result.new.jumlah)} — ${result.new.keterangan}\n\n` +
      `💰 *Saldo: ${formatRupiah(result.saldoBaru)}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /edit:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat mengedit transaksi. Silakan coba lagi nanti.');
  }
});

// ─── /bulan <bulan> <tahun> ──────────────────────────────────────────
bot.command('bulan', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply(
        '⚠️ Format: `/bulan <bulan> <tahun>`\n' +
        'Contoh: `/bulan 1 2026` untuk Januari 2026',
        { parse_mode: 'Markdown' }
      );
    }

    const month = parseInt(args[0]);
    const year = parseInt(args[1]);

    if (isNaN(month) || month < 1 || month > 12 || isNaN(year)) {
      return ctx.reply('⚠️ Bulan harus 1-12 dan tahun harus valid!');
    }

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
      `${selisih >= 0 ? '📈' : '📉'} Selisih: ${formatRupiah(selisih)}\n\n` +
      `📋 Total Transaksi: ${report.jumlahTransaksi}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /bulan:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat mengambil laporan.');
  }
});

// ─── /grafik ─────────────────────────────────────────────────────────
bot.command('grafik', async (ctx) => {
  try {
    const data = await sheets.getMonthlyBreakdown();

    if (data.length === 0) {
      return ctx.reply('📋 Belum ada data transaksi untuk dibuat grafik.');
    }

    const labels = data.map((d) => d.label);
    const masukData = data.map((d) => d.totalMasuk);
    const keluarData = data.map((d) => d.totalKeluar);

    const chartConfig = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Pemasukan',
            data: masukData,
            backgroundColor: 'rgba(75, 192, 192, 0.8)',
          },
          {
            label: 'Pengeluaran',
            data: keluarData,
            backgroundColor: 'rgba(255, 99, 132, 0.8)',
          },
        ],
      },
      options: {
        title: { display: true, text: 'Pemasukan vs Pengeluaran' },
        scales: {
          yAxes: [{ ticks: { beginAtZero: true, min: 0 } }],
        },
      },
    };

    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400&bkg=white`;

    await ctx.replyWithPhoto({ url: chartUrl }, { caption: '📈 Grafik Keuangan' });
  } catch (error) {
    console.error('Error /grafik:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat membuat grafik.');
  }
});

// ─── /export ─────────────────────────────────────────────────────────
bot.command('export', async (ctx) => {
  try {
    const transactions = await sheets.getAllTransactions();

    if (transactions.length === 0) {
      return ctx.reply('📋 Belum ada transaksi untuk di-export.');
    }

    // Hitung total
    let totalMasuk = 0;
    let totalKeluar = 0;
    transactions.forEach((tx) => {
      if (tx.tipe === 'MASUK') totalMasuk += tx.jumlah;
      else if (tx.tipe === 'KELUAR') totalKeluar += tx.jumlah;
    });

    // Buat PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    const pdfReady = new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const pageW = 495; // A4 width - 2*margin
    const leftM = 50;
    const rightEdge = leftM + pageW;
    const exportDate = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];

    // ── Header bar ──
    doc.rect(leftM, 45, pageW, 40).fill('#1a1a1a');
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#ffffff')
      .text('LAPORAN KEUANGAN', leftM + 15, 55, { width: pageW - 30 });
    doc.fontSize(8).font('Helvetica').fillColor('#cccccc')
      .text(exportDate, leftM + 15, 70, { width: pageW - 30 });

    doc.y = 100;

    // ── Summary box ──
    const saldo = totalMasuk - totalKeluar;
    const summaryY = doc.y;
    doc.rect(leftM, summaryY, pageW, 60).fill('#f5f5f5');
    doc.rect(leftM, summaryY, pageW, 60).lineWidth(0.5).strokeColor('#e0e0e0').stroke();

    const col3W = pageW / 3;
    const summaryItems = [
      { label: 'PEMASUKAN', value: formatRupiah(totalMasuk) },
      { label: 'PENGELUARAN', value: formatRupiah(totalKeluar) },
      { label: 'SALDO', value: formatRupiah(saldo) },
    ];

    summaryItems.forEach((item, i) => {
      const x = leftM + col3W * i;
      // Vertical separator
      if (i > 0) {
        doc.moveTo(x, summaryY + 10).lineTo(x, summaryY + 50).lineWidth(0.5).strokeColor('#d0d0d0').stroke();
      }
      doc.fontSize(7).font('Helvetica').fillColor('#888888')
        .text(item.label, x + 15, summaryY + 15, { width: col3W - 30 });
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a')
        .text(item.value, x + 15, summaryY + 30, { width: col3W - 30 });
    });

    doc.y = summaryY + 75;

    // ── Info line ──
    doc.fontSize(8).font('Helvetica').fillColor('#999999')
      .text(`${transactions.length} transaksi`, leftM, doc.y);
    doc.moveDown(1);

    // ── Table ──
    const colWidths = [75, 50, 55, 90, 145, 80];
    const colX = [];
    let cx = leftM;
    colWidths.forEach((w) => { colX.push(cx); cx += w; });

    const colHeaders = ['TANGGAL', 'WAKTU', 'TIPE', 'JUMLAH', 'KETERANGAN', 'SALDO'];
    const rowH = 18;

    function drawTableHeader(y) {
      // Header background
      doc.rect(leftM, y, pageW, rowH).fill('#1a1a1a');
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#ffffff');
      colHeaders.forEach((h, i) => {
        doc.text(h, colX[i] + 6, y + 5, { width: colWidths[i] - 12, lineBreak: false });
      });
      return y + rowH;
    }

    let rowY = drawTableHeader(doc.y);

    // Data rows
    transactions.forEach((tx, idx) => {
      // Page break check
      if (rowY + rowH > 780) {
        doc.addPage();
        rowY = drawTableHeader(50);
      }

      // Alternating background
      if (idx % 2 === 0) {
        doc.rect(leftM, rowY, pageW, rowH).fill('#fafafa');
      } else {
        doc.rect(leftM, rowY, pageW, rowH).fill('#ffffff');
      }

      // Bottom border
      doc.moveTo(leftM, rowY + rowH).lineTo(rightEdge, rowY + rowH)
        .lineWidth(0.3).strokeColor('#e8e8e8').stroke();

      const textY = rowY + 5;
      doc.fontSize(7.5).font('Helvetica').fillColor('#333333');

      doc.text(tx.tanggal, colX[0] + 6, textY, { width: colWidths[0] - 12, lineBreak: false });
      doc.text(tx.waktu, colX[1] + 6, textY, { width: colWidths[1] - 12, lineBreak: false });

      // Tipe — just slightly different shade
      const tipeColor = tx.tipe === 'MASUK' ? '#333333' : '#666666';
      doc.fillColor(tipeColor).font('Helvetica-Bold')
        .text(tx.tipe, colX[2] + 6, textY, { width: colWidths[2] - 12, lineBreak: false });

      const sign = tx.tipe === 'MASUK' ? '+' : '-';
      doc.fillColor('#333333').font('Helvetica')
        .text(`${sign}${formatRupiah(tx.jumlah)}`, colX[3] + 6, textY, { width: colWidths[3] - 12, lineBreak: false });
      doc.text(tx.keterangan.substring(0, 22), colX[4] + 6, textY, { width: colWidths[4] - 12, lineBreak: false });
      doc.text(formatRupiah(tx.saldo), colX[5] + 6, textY, { width: colWidths[5] - 12, lineBreak: false });

      rowY += rowH;
    });

    // Bottom border
    doc.moveTo(leftM, rowY).lineTo(rightEdge, rowY).lineWidth(0.5).strokeColor('#1a1a1a').stroke();

    doc.end();
    const buffer = await pdfReady;

    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const filename = `keuangan_${wib.toISOString().split('T')[0]}.pdf`;

    await ctx.replyWithDocument(
      { source: buffer, filename },
      { caption: `📁 Export ${transactions.length} transaksi (PDF)` }
    );
  } catch (error) {
    console.error('Error /export:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat export data.');
  }
});

// ─── /reset ──────────────────────────────────────────────────────────
const resetConfirm = new Map();

bot.command('reset', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ').slice(1);

    if (args[0] === 'KONFIRMASI') {
      // Cek apakah user sudah request reset sebelumnya
      if (!resetConfirm.has(userId)) {
        return ctx.reply('⚠️ Ketik `/reset` dulu sebelum konfirmasi.', { parse_mode: 'Markdown' });
      }

      resetConfirm.delete(userId);
      const count = await sheets.resetAllData();

      return ctx.reply(
        `🔄 *Reset berhasil!*\n\n` +
        `${count} transaksi telah dihapus. Data dimulai dari awal.`,
        { parse_mode: 'Markdown' }
      );
    }

    // Set konfirmasi (berlaku 60 detik)
    resetConfirm.set(userId, Date.now());
    setTimeout(() => resetConfirm.delete(userId), 60000);

    ctx.reply(
      `⚠️ *PERINGATAN!*\n\n` +
      `Perintah ini akan *menghapus SEMUA* data transaksi.\n` +
      `Aksi ini *tidak bisa dibatalkan*.\n\n` +
      `Jika yakin, ketik:\n` +
      `\`/reset KONFIRMASI\`\n\n` +
      `Konfirmasi berlaku 60 detik.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /reset:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat reset data.');
  }
});

// ─── /migrasi — Pindahkan data Sheet1 ke sheet bulanan ──────────────
bot.command('migrasi', async (ctx) => {
  try {
    ctx.reply('⏳ Memulai migrasi data dari Sheet1 ke sheet per bulan...');
    const result = await sheets.migrateFromSheet1();

    if (result) {
      ctx.reply('✅ *Migrasi selesai!*\n\nData dari Sheet1 sudah dipindahkan ke sheet per bulan.', { parse_mode: 'Markdown' });
    } else {
      ctx.reply('ℹ️ Tidak ada data di Sheet1 untuk dimigrasi, atau Sheet1 tidak ditemukan.');
    }
  } catch (error) {
    console.error('Error /migrasi:', error.message);
    ctx.reply('❌ Terjadi kesalahan saat migrasi: ' + error.message);
  }
});

// ─── Pesan tidak dikenali (hanya di private chat) ───────────────────
bot.on('text', (ctx) => {
  if (ctx.chat.type !== 'private') return;

  ctx.reply(
    '🤔 Perintah tidak dikenali.\n\nKetik /help untuk melihat daftar perintah yang tersedia.'
  );
});

// ─── Export bot untuk webhook & support polling untuk dev lokal ──────
module.exports = bot;

// Jika dijalankan langsung (node src/bot.js) → mode polling untuk development
if (require.main === module) {
  (async () => {
    try {
      // Auto-migrasi jika Sheet1 masih ada
      await sheets.migrateFromSheet1();
      await sheets.initializeSheet();
      console.log('✅ Koneksi Google Sheets berhasil.');
      await bot.launch();
      console.log('🤖 Bot berhasil berjalan! (polling mode)');
    } catch (error) {
      console.error('❌ Gagal menjalankan bot:', error.message);
      process.exit(1);
    }
  })();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
