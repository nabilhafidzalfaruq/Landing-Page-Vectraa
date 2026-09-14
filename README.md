# VECTRA Competition Portal — Vercel + Firebase Auth + Apps Script

## Struktur proyek
```
index.html              landing page + dashboard (struktur/class/id 100% sama seperti asli)
style.css               tidak diubah sama sekali
firebase-config.js      isi config Firebase + GAS_API_URL di sini
script.js               logika frontend (fetch() ke GAS, Firebase Auth)
code-gs-adapter.gs       tempel ke Code.gs yang sudah ada di project Apps Script kamu
public/logos/           taruh file logo di sini (lihat README di dalamnya)
```

## Langkah setup

1. **Firebase**
   - Buat project di https://console.firebase.google.com
   - Authentication → Sign-in method → aktifkan **Email/Password**
   - Project settings → General → tambah Web App → salin config ke `firebase-config.js`

2. **Google Apps Script (backend, tetap pakai Sheets + Drive)**
   - Buka project Apps Script yang sudah ada (berisi login, saveDraft, dst.)
   - Tempel isi `code-gs-adapter.gs` ke `Code.gs`
   - Sesuaikan `login()` dan `registerAccount()` agar menerima `{email, uid, idToken}` bukan password mentah lagi — catatan lengkap ada di komentar file adapter
   - Tambahkan `getPublicBootstrap()` dan `uploadRegistrationFile()` — templatenya juga ada di komentar file adapter
   - Deploy → New deployment → Web app → Execute as **Me** → Who has access **Anyone**
   - Salin URL `/exec` ke `GAS_API_URL` di `firebase-config.js`

3. **Logo**
   - Taruh `brand.png` dan `<competition_id>.png` di `public/logos/`
   - Detail di `public/logos/README.md`

4. **Deploy ke Vercel**
   - Push folder ini ke repo Git, lalu import di https://vercel.com/new
   - Tidak perlu build command — ini static site (Vercel akan otomatis serve semua file apa adanya)
   - Root directory: folder ini

## Yang perlu diverifikasi manual
- `login`/`registerAccount` di Code.gs kamu (saya tidak punya isi aslinya, hanya kerangka HTTP-nya)
- Verifikasi Firebase idToken di sisi Apps Script (contoh pakai endpoint tokeninfo ada di komentar adapter — untuk produksi yang lebih ketat, pertimbangkan Firebase Admin REST API dengan service account)
