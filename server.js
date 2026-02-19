const express = require("express");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcrypt");
require("dotenv").config();

const app = express();

// ---------------- Session ----------------
app.use(session({
  secret: process.env.SESSION_SECRET || "default_fallback_key", 
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ---------------- Middleware ----------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// ---------------- Basic Setup ----------------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/videos", express.static(path.join(__dirname, "videos")));
app.use("/thumbnails", express.static(path.join(__dirname, "thumbnails")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const ADMIN_USER = process.env.USER;
const ADMIN_PASS_HASH = process.env.PASSWORD;

// ---------------- Database ----------------
const dbPath = path.join(__dirname, "db", "database.sqlite");
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    thumbnail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ---------------- Multer ----------------
if (!fs.existsSync('videos')) fs.mkdirSync('videos');
if (!fs.existsSync('thumbnails')) fs.mkdirSync('thumbnails');

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    if (file.fieldname === 'video') cb(null, 'videos/');
    else cb(null, 'thumbnails/');
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + "_" + file.originalname);
  }
});
const upload = multer({ storage });

// ---------------- Login System ----------------
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    const USER = process.env.USER;
    const PASSWORD_HASH = process.env.PASSWORD;

    if (username !== USER)
        return res.render("login", { error: "Invalid username or password" });

    const valid = await bcrypt.compare(password, PASSWORD_HASH);

    if (!valid)
        return res.render("login", { error: "Invalid username or password" });

    req.session.user = username;
    res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ---------------- Routes ----------------

// Home (protected)
app.get("/", requireLogin, (req, res) => {
  db.all("SELECT * FROM videos ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.send(err.message);
    res.render("index", { videos: rows });
  });
});

// Player page (no login required)
app.get("/player/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err, row) => {
    if (err) return res.send(err.message);
    if (!row) return res.status(404).send("Video not found");
    res.render("player", { media: row });
  });
});

// Add Video
app.get("/add", requireLogin, (req, res) => res.render("add", { video: {} }));

app.post("/videos", requireLogin, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), (req, res) => {
  const title = req.body.title;
  const videoFile = req.files.video ? req.files.video[0].filename : null;
  const thumbFile = req.files.thumbnail ? req.files.thumbnail[0].filename : null;

  if (!title || !videoFile) return res.send("Title and video required");

  db.run("INSERT INTO videos (title, filename, thumbnail) VALUES (?,?,?)",
    [title, videoFile, thumbFile],
    (err) => {
      if (err) return res.send(err.message);
      res.redirect("/");
    });
});

// Edit Video
app.get("/videos/:id/edit", requireLogin, (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err, row) => {
    if (err) return res.send(err.message);
    if (!row) return res.status(404).send("Video not found");
    res.render("add", { video: row });
  });
});

app.post("/videos/:id", requireLogin, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), (req, res) => {
  const id = req.params.id;
  const { title } = req.body;

  db.get("SELECT * FROM videos WHERE id=?", [id], (err, row) => {
    if (err) return res.send(err.message);
    if (!row) return res.status(404).send("Video not found");

    const newVideo = req.files.video ? req.files.video[0].filename : row.filename;
    const newThumb = req.files.thumbnail ? req.files.thumbnail[0].filename : row.thumbnail;

    // delete old files
    if (req.files.video && fs.existsSync(path.join("videos", row.filename)))
      fs.unlinkSync(path.join("videos", row.filename));

    if (req.files.thumbnail && row.thumbnail && fs.existsSync(path.join("thumbnails", row.thumbnail)))
      fs.unlinkSync(path.join("thumbnails", row.thumbnail));

    db.run("UPDATE videos SET title=?, filename=?, thumbnail=? WHERE id=?",
      [title, newVideo, newThumb, id], err => {
        if (err) return res.send(err.message);
        res.redirect("/");
      });
  });
});

// Delete Video
app.post("/videos/:id/delete", requireLogin, (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err, row) => {
    if (err) return res.send(err.message);
    if (!row) return res.status(404).send("Video not found");

    if (fs.existsSync(path.join("videos", row.filename)))
      fs.unlinkSync(path.join("videos", row.filename));

    if (row.thumbnail && fs.existsSync(path.join("thumbnails", row.thumbnail)))
      fs.unlinkSync(path.join("thumbnails", row.thumbnail));

    db.run("DELETE FROM videos WHERE id=?", [id], (err) => {
      if (err) return res.send(err.message);
      res.redirect("/");
    });
  });
});

// Thumbnail fullscreen
app.get("/thumbnail/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT thumbnail, title FROM videos WHERE id=?", [id], (err, row) => {
    if (err) return res.send(err.message);
    if (!row || !row.thumbnail) return res.status(404).send("Thumbnail not found");
    res.render("thumbnail", { media: row });
  });
});

// ---------------- Start Server ----------------
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server running: http://localhost:${port}`));
