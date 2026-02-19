# 💰 Bot Telegram Pencatatan Keuangan

Bot Telegram untuk mencatat pemasukan dan pengeluaran, dengan penyimpanan data di Google Sheets.

## Fitur

| Perintah | Fungsi |
|---|---|
| `/start` | Pesan sambutan |
| `/help` | Panduan penggunaan |
| `/masuk <jumlah> <keterangan>` | Catat pemasukan |
| `/keluar <jumlah> <keterangan>` | Catat pengeluaran |
| `/laporan` | Ringkasan keuangan bulan ini |
| `/riwayat` | 10 transaksi terakhir |

## Struktur Google Sheets

| Tanggal | Waktu | User ID | Username | Tipe | Jumlah | Keterangan | Saldo Kumulatif |
|---|---|---|---|---|---|---|---|

---

## 📋 Panduan Setup Lengkap

### 1. Buat Bot di Telegram

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`
3. Ikuti instruksi — beri nama dan username untuk bot
4. Catat **Token API** yang diberikan (format: `123456:ABC-DEF...`)

### 2. Setup Google Cloud Service Account

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru (atau pilih project yang ada)
3. Aktifkan **Google Sheets API**:
   - Pergi ke **APIs & Services** → **Library**
   - Cari "Google Sheets API" lalu klik **Enable**
4. Buat Service Account:
   - Pergi ke **APIs & Services** → **Credentials**
   - Klik **Create Credentials** → **Service Account**
   - Beri nama, lalu klik **Done**
5. Buat Key JSON:
   - Klik service account yang baru dibuat
   - Pergi ke tab **Keys** → **Add Key** → **Create new key**
   - Pilih **JSON** → **Create**
   - File JSON akan terdownload — buka file tersebut
6. Dari file JSON, catat:
   - `client_email` → ini adalah **GOOGLE_SERVICE_ACCOUNT_EMAIL**
   - `private_key` → ini adalah **GOOGLE_PRIVATE_KEY**

### 3. Setup Google Sheets

1. Buka [Google Sheets](https://sheets.google.com/) dan buat spreadsheet baru
2. Ambil **Spreadsheet ID** dari URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_DISINI/edit
   ```
3. **Share spreadsheet** ke email service account:
   - Klik tombol **Share** di kanan atas
   - Masukkan email service account (`...@...iam.gserviceaccount.com`)
   - Beri akses **Editor**
   - Klik **Send**

### 4. Setup Environment Variables

1. Copy file `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
2. Isi nilai-nilai berikut di file `.env`:
   ```env
   TELEGRAM_TOKEN=token_dari_botfather
   GOOGLE_SHEET_ID=id_spreadsheet_anda
   GOOGLE_SERVICE_ACCOUNT_EMAIL=email_service_account
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```

> **💡 Tips untuk GOOGLE_PRIVATE_KEY:** Copy seluruh nilai `private_key` dari file JSON service account (termasuk `-----BEGIN...` dan `-----END...`). Pastikan dibungkus dengan tanda kutip ganda (`"`).

### 5. Jalankan Secara Lokal

```bash
# Install dependencies
npm install

# Jalankan bot
npm start
```

Bot akan menampilkan `🤖 Bot berhasil berjalan!` jika berhasil.

### 6. Deploy ke Railway

1. Push project ke GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/USERNAME/finance-bot.git
   git push -u origin main
   ```

2. Buka [Railway.app](https://railway.app/) dan login

3. Klik **New Project** → **Deploy from GitHub repo**

4. Pilih repository `finance-bot`

5. Tambahkan environment variables:
   - Klik project → **Variables** → **New Variable**
   - Tambahkan semua variabel dari `.env`:
     - `TELEGRAM_TOKEN`
     - `GOOGLE_SHEET_ID`
     - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
     - `GOOGLE_PRIVATE_KEY`

6. Railway akan otomatis deploy. Cek **Logs** untuk memastikan bot berjalan.

> **⚠️ Penting:** Untuk `GOOGLE_PRIVATE_KEY` di Railway, paste private key apa adanya dari file JSON (termasuk `\n`). Railway akan menangani formatnya.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Bot tidak merespon | Cek `TELEGRAM_TOKEN` sudah benar |
| Error Google Sheets | Pastikan spreadsheet sudah di-share ke service account |
| `private_key` error | Pastikan key dibungkus tanda kutip dan `\n` tidak hilang |
| Saldo tidak akurat | Jangan edit data langsung di Google Sheets |

## Tech Stack

- **Runtime:** Node.js
- **Bot Library:** [Telegraf](https://telegraf.js.org/)
- **Database:** Google Sheets via [googleapis](https://www.npmjs.com/package/googleapis)
- **Hosting:** [Railway.app](https://railway.app/)
