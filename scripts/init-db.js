require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/db");

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
    await pool.query(schema);
    console.log("Tabel users dan items berhasil dibuat.");
  } catch (err) {
    console.error("Gagal membuat schema:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
