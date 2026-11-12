require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../src/db");

(async () => {
  const name = process.env.ADMIN_NAME || "Administrator";
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || password.length < 12) {
    console.error("Set ADMIN_EMAIL dan ADMIN_PASSWORD (minimal 12 karakter) di environment.");
    process.exitCode = 1;
    await pool.end();
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET
         name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='admin'`,
      [name, email, hash]
    );
    console.log(`Admin siap: ${email}`);
  } catch (err) {
    console.error("Gagal membuat admin:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
