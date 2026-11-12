const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const root = path.join(__dirname, "..", "uploads");
const photoDir = path.join(root, "photos");
const documentDir = path.join(root, "documents");

for (const dir of [photoDir, documentDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const documentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain"
]);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, file.fieldname === "photo" ? photoDir : documentDir);
  },
  filename(req, file, cb) {
    cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  }
});

function fileFilter(req, file, cb) {
  const allowed = file.fieldname === "photo" ? photoTypes : documentTypes;
  if (!allowed.has(file.mimetype)) return cb(new Error("Tipe file tidak diizinkan."));
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 2 }
});

module.exports = { upload, photoDir, documentDir };
