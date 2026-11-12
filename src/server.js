require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { requireAuth, requireAdmin } = require("./auth");
const { upload, photoDir, documentDir } = require("./upload");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET wajib diisi minimal 32 karakter di file .env");
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  name: "crud.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SESSION_SECURE === "true",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function removeFile(directory, filename) {
  if (!filename) return;
  const safeName = path.basename(filename);
  fs.unlink(path.join(directory, safeName), (err) => {
    if (err && err.code !== "ENOENT") console.error("File cleanup:", err);
  });
}

function cleanupUploads(req) {
  if (!req.files) return;
  for (const file of Object.values(req.files).flat()) {
    removeFile(file.fieldname === "photo" ? photoDir : documentDir, file.filename);
  }
}

function uploaded(req, field) {
  return req.files && req.files[field] ? req.files[field][0] : null;
}

function uploadFields(req, res, next) {
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "document", maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      cleanupUploads(req);
      return res.status(400).render("error", {
        message: err.code === "LIMIT_FILE_SIZE" ? "Ukuran setiap file maksimal 5 MB." : err.message
      });
    }
    next();
  });
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Public pages and authentication
app.get("/", (req, res) => res.redirect(req.session.user ? "/items" : "/login"));

app.get("/register", (req, res) => {
  if (req.session.user) return res.redirect("/items");
  res.render("register", { error: null, values: {} });
});

app.post("/register", async (req, res, next) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const values = { name, email };

  if (name.length < 2 || name.length > 120 || !validEmail(email) || password.length < 8) {
    return res.status(400).render("register", {
      error: "Periksa nama, email, dan password. Password minimal 8 karakter.",
      values
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)",
      [name, email, passwordHash]
    );
    res.redirect("/login?registered=1");
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).render("register", { error: "Email sudah terdaftar.", values });
    }
    next(err);
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/items");
  res.render("login", {
    error: null,
    registered: req.query.registered === "1"
  });
});

app.post("/login", async (req, res, next) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  try {
    const result = await pool.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    const valid = user && await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).render("login", {
        error: "Email atau password salah.",
        registered: false
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(user.role === "admin" ? "/admin" : "/items");
      });
    });
  } catch (err) { next(err); }
});

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("crud.sid");
    res.redirect("/login");
  });
});

// Private photo delivery: only the owner or an administrator can view an uploaded photo.
app.get("/items/:id/photo", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT photo_filename FROM items WHERE id=$1 AND user_id=$2",
      [req.params.id, req.session.user.id]
    );
    if (!result.rowCount || !result.rows[0].photo_filename) {
      return res.status(404).render("error", { message: "Foto tidak ditemukan." });
    }
    res.sendFile(path.join(photoDir, path.basename(result.rows[0].photo_filename)));
  } catch (err) { next(err); }
});

app.get("/admin/items/:id/photo", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT photo_filename FROM items WHERE id=$1",
      [req.params.id]
    );
    if (!result.rowCount || !result.rows[0].photo_filename) {
      return res.status(404).render("error", { message: "Foto tidak ditemukan." });
    }
    res.sendFile(path.join(photoDir, path.basename(result.rows[0].photo_filename)));
  } catch (err) { next(err); }
});

// User CRUD: every query is scoped to the current user.
app.get("/items", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM items WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.user.id]
    );
    res.render("items", { items: result.rows });
  } catch (err) { next(err); }
});

app.get("/items/new", requireAuth, (req, res) => res.render("item-form", { item: null }));

app.post("/items", requireAuth, uploadFields, async (req, res, next) => {
  const name = (req.body.name || "").trim();
  const description = (req.body.description || "").trim();
  const photo = uploaded(req, "photo");
  const document = uploaded(req, "document");

  if (!name || name.length > 150) {
    cleanupUploads(req);
    return res.status(400).render("error", { message: "Nama wajib diisi (maksimal 150 karakter)." });
  }

  try {
    await pool.query(
      `INSERT INTO items (user_id, name, description, photo_filename, document_filename, document_original_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.session.user.id, name, description, photo?.filename || null,
       document?.filename || null, document?.originalname || null]
    );
    res.redirect("/items");
  } catch (err) {
    cleanupUploads(req);
    next(err);
  }
});

app.get("/items/:id/edit", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM items WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.user.id]
    );
    if (!result.rowCount) return res.status(404).render("error", { message: "Data tidak ditemukan." });
    res.render("item-form", { item: result.rows[0] });
  } catch (err) { next(err); }
});

app.post("/items/:id/update", requireAuth, uploadFields, async (req, res, next) => {
  const name = (req.body.name || "").trim();
  const description = (req.body.description || "").trim();
  const photo = uploaded(req, "photo");
  const document = uploaded(req, "document");

  if (!name || name.length > 150) {
    cleanupUploads(req);
    return res.status(400).render("error", { message: "Nama wajib diisi (maksimal 150 karakter)." });
  }

  try {
    const oldResult = await pool.query(
      "SELECT * FROM items WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.user.id]
    );
    if (!oldResult.rowCount) {
      cleanupUploads(req);
      return res.status(404).render("error", { message: "Data tidak ditemukan." });
    }

    const old = oldResult.rows[0];
    await pool.query(
      `UPDATE items SET name=$1, description=$2, photo_filename=$3,
       document_filename=$4, document_original_name=$5, updated_at=NOW()
       WHERE id=$6 AND user_id=$7`,
      [name, description, photo?.filename || old.photo_filename,
       document?.filename || old.document_filename,
       document?.originalname || old.document_original_name,
       req.params.id, req.session.user.id]
    );

    if (photo) removeFile(photoDir, old.photo_filename);
    if (document) removeFile(documentDir, old.document_filename);
    res.redirect("/items");
  } catch (err) {
    cleanupUploads(req);
    next(err);
  }
});

app.post("/items/:id/delete", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM items WHERE id=$1 AND user_id=$2 RETURNING photo_filename, document_filename",
      [req.params.id, req.session.user.id]
    );
    if (!result.rowCount) return res.status(404).render("error", { message: "Data tidak ditemukan." });
    removeFile(photoDir, result.rows[0].photo_filename);
    removeFile(documentDir, result.rows[0].document_filename);
    res.redirect("/items");
  } catch (err) { next(err); }
});

app.get("/items/:id/download", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT document_filename, document_original_name FROM items
       WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.session.user.id]
    );
    if (!result.rowCount || !result.rows[0].document_filename) {
      return res.status(404).render("error", { message: "Dokumen tidak ditemukan." });
    }
    const row = result.rows[0];
    res.download(path.join(documentDir, path.basename(row.document_filename)),
      row.document_original_name || "dokumen", (err) => {
        if (err && !res.headersSent) next(err);
      });
  } catch (err) { next(err); }
});

// Admin dashboard and management
app.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const [users, items, stats] = await Promise.all([
      pool.query("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC"),
      pool.query(
        `SELECT items.*, users.name AS owner_name, users.email AS owner_email
         FROM items JOIN users ON users.id = items.user_id ORDER BY items.created_at DESC`
      ),
      pool.query(
        `SELECT (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COUNT(*) FROM items) AS total_items,
                (SELECT COUNT(*) FROM users WHERE role='admin') AS total_admins`
      )
    ]);
    res.render("admin", {
      users: users.rows,
      items: items.rows,
      stats: stats.rows[0]
    });
  } catch (err) { next(err); }
});

app.post("/admin/users/:id/delete", requireAdmin, async (req, res, next) => {
  if (String(req.session.user.id) === String(req.params.id)) {
    return res.status(400).render("error", { message: "Admin tidak dapat menghapus akunnya sendiri." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).render("error", { message: "Pengguna tidak ditemukan." });
    }
    const owned = await client.query(
      "SELECT photo_filename, document_filename FROM items WHERE user_id=$1",
      [req.params.id]
    );
    await client.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    for (const row of owned.rows) {
      removeFile(photoDir, row.photo_filename);
      removeFile(documentDir, row.document_filename);
    }
    res.redirect("/admin");
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// Admin can manage all records; normal users cannot reach these routes.
app.post("/admin/items/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM items WHERE id=$1 RETURNING photo_filename, document_filename",
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).render("error", { message: "Data tidak ditemukan." });
    removeFile(photoDir, result.rows[0].photo_filename);
    removeFile(documentDir, result.rows[0].document_filename);
    res.redirect("/admin");
  } catch (err) { next(err); }
});

app.get("/admin/items/:id/download", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT document_filename, document_original_name FROM items WHERE id=$1",
      [req.params.id]
    );
    if (!result.rowCount || !result.rows[0].document_filename) {
      return res.status(404).render("error", { message: "Dokumen tidak ditemukan." });
    }
    const row = result.rows[0];
    res.download(path.join(documentDir, path.basename(row.document_filename)),
      row.document_original_name || "dokumen", (err) => {
        if (err && !res.headersSent) next(err);
      });
  } catch (err) { next(err); }
});

app.use((req, res) => res.status(404).render("error", { message: "Halaman tidak ditemukan." }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render("error", { message: "Terjadi kesalahan server. Periksa terminal untuk detail." });
});

app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
