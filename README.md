# Express PostgreSQL Multi-User CRUD

Fitur: register/login/logout, password hashing, session PostgreSQL, data isolation per user, admin dashboard, upload foto/dokumen, dan penghapusan file.

## Persyaratan
- Node.js 18+
- PostgreSQL 14+
- npm

## 1. Buat database
Di pgAdmin atau psql:
```sql
CREATE DATABASE crud_multiuser_db;
```

## 2. Konfigurasi environment
Salin `.env.example` menjadi `.env`. Isi password PostgreSQL dan session secret acak minimal 32 karakter:
```env
PORT=3000
DATABASE_URL=postgresql://postgres:password_kamu@localhost:5432/crud_multiuser_db
SESSION_SECRET=isi_string_acak_minimal_32_karakter
SESSION_SECURE=false
```
Untuk produksi dengan HTTPS, ubah `SESSION_SECURE=true` dan konfigurasi Express di belakang trusted proxy sesuai infrastruktur.

## 3. Instal dependency dan buat tabel
```bash
npm install
npm run db:init
```

## 4. Buat akun admin pertama
PowerShell:
```powershell
$env:ADMIN_NAME="Administrator"
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="PasswordAdminYangPanjang!"
npm run admin:create
```
Gunakan email dan password tersebut untuk login. Password admin minimal 12 karakter. Perintah ini membuat atau memperbarui akun dengan email yang diberikan menjadi admin.

## 5. Jalankan aplikasi
```bash
npm run dev
```
Buka http://localhost:3000

## 6. Pengujian
1. Register dua akun pengguna biasa melalui `/register`.
2. Login akun pertama, buat data dengan foto/dokumen.
3. Logout, login akun kedua. Data akun pertama tidak boleh terlihat.
4. Login admin yang dibuat pada langkah 4. Buka `/admin` untuk melihat seluruh pengguna dan data.
5. Admin dapat menghapus pengguna lain dan seluruh data miliknya, serta menghapus data individual.

## Struktur
- `src/server.js`: routes, authentication, authorization, CRUD.
- `src/auth.js`: middleware login dan admin.
- `src/upload.js`: konfigurasi Multer.
- `src/db.js`: PostgreSQL pool.
- `database/schema.sql`: tabel users dan items.
- `scripts/`: inisialisasi database dan pembuatan admin.
- `views/`: template EJS.
- `uploads/`: file upload.

## Catatan keamanan penting
Ini adalah starter project pembelajaran lokal, bukan aplikasi siap internet. Sebelum produksi:
- Tambahkan CSRF protection untuk semua form yang mengubah data.
- Tambahkan rate limiting untuk login/register.
- Verifikasi isi file dengan signature/magic bytes; MIME dari browser dapat dipalsukan.
- Simpan dokumen di luar public path (sudah diterapkan) dan layani melalui route terotorisasi.
- Foto disajikan melalui route terotorisasi: pemilik data atau admin yang dapat melihatnya.
- Tambahkan antivirus, backup, logging, HTTPS, kebijakan password, dan pengujian.
- Batasi atau audit tindakan admin. Formulir admin saat ini dapat menghapus pengguna/data, bukan mengedit role atau password pengguna.
- Pertimbangkan transaksi database dan proses cleanup terjadwal untuk menangani file yatim jika operasi file/database gagal di tengah proses.


## Frontend design
UI menggunakan Bootstrap 5.3, Bootstrap Icons, Google Fonts (DM Sans dan Plus Jakarta Sans), custom CSS, responsive navbar, auth cards, collection cards, empty state, dan admin dashboard dengan statistic cards serta responsive tables. CDN membutuhkan koneksi internet saat membuka aplikasi.
