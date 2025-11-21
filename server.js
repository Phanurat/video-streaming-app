const express = require("express");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/videos", express.static(path.join(__dirname, "videos")));
app.use("/thumbnails", express.static(path.join(__dirname, "thumbnails")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Missing or invalid API key" });
  }
  next();
}


// DB setup
const dbPath = path.join(__dirname, "db", "database.sqlite");
if(!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
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

// Multer
if(!fs.existsSync('videos')) fs.mkdirSync('videos');
if(!fs.existsSync('thumbnails')) fs.mkdirSync('thumbnails');

const storage = multer.diskStorage({
  destination: function(req,file,cb){
    if(file.fieldname === 'video') cb(null,'videos/');
    else cb(null,'thumbnails/');
  },
  filename: function(req,file,cb){
    cb(null, Date.now()+"_"+file.originalname);
  }
});
const upload = multer({ storage: storage });

// -------- Routes --------

// Home / Thumbnail list
app.get("/", (req,res)=>{
  db.all("SELECT * FROM videos ORDER BY created_at DESC", [], (err, rows)=>{
    if(err) return res.send(err.message);
    res.render("index", { videos: rows });
  });
});

// Player page
app.get("/player/:id", (req,res)=>{
  const id = req.params.id;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err,row)=>{
    if(err) return res.send(err.message);
    if(!row) return res.status(404).send("Video not found");
    res.render("player", { media: row });
  });
});

// Add Video
app.get("/add", (req,res)=> res.render("add", { video:{} }));
app.post("/videos", upload.fields([
  { name:'video', maxCount:1 },
  { name:'thumbnail', maxCount:1 }
]), (req,res)=>{
  const title = req.body.title;
  const videoFile = req.files.video ? req.files.video[0].filename : null;
  const thumbFile = req.files.thumbnail ? req.files.thumbnail[0].filename : null;
  if(!title || !videoFile) return res.send("Title and video required");
  db.run("INSERT INTO videos (title, filename, thumbnail) VALUES (?,?,?)", [title, videoFile, thumbFile], (err)=>{
    if(err) return res.send(err.message);
    res.redirect("/");
  });
});

// Edit Video
app.get("/videos/:id/edit", (req,res)=>{
  const id = req.params.id;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err,row)=>{
    if(err) return res.send(err.message);
    if(!row) return res.status(404).send("Video not found");
    res.render("add", { video: row });
  });
});
app.post("/videos/:id", upload.fields([
  { name:'video', maxCount:1 },
  { name:'thumbnail', maxCount:1 }
]), (req,res)=>{
  const id = req.params.id;
  const { title } = req.body;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err,row)=>{
    if(err) return res.send(err.message);
    if(!row) return res.status(404).send("Video not found");

    const newVideo = req.files.video ? req.files.video[0].filename : row.filename;
    const newThumb = req.files.thumbnail ? req.files.thumbnail[0].filename : row.thumbnail;

    // ลบไฟล์เก่า
    if(req.files.video && fs.existsSync(path.join("videos", row.filename))) fs.unlinkSync(path.join("videos", row.filename));
    if(req.files.thumbnail && row.thumbnail && fs.existsSync(path.join("thumbnails", row.thumbnail))) fs.unlinkSync(path.join("thumbnails", row.thumbnail));

    db.run("UPDATE videos SET title=?, filename=?, thumbnail=? WHERE id=?", [title,newVideo,newThumb,id], (err)=>{
      if(err) return res.send(err.message);
      res.redirect("/");
    });
  });
});

// Delete Video
app.post("/videos/:id/delete", (req,res)=>{
  const id = req.params.id;
  db.get("SELECT * FROM videos WHERE id=?", [id], (err,row)=>{
    if(err) return res.send(err.message);
    if(!row) return res.status(404).send("Video not found");

    if(fs.existsSync(path.join("videos", row.filename))) fs.unlinkSync(path.join("videos", row.filename));
    if(row.thumbnail && fs.existsSync(path.join("thumbnails", row.thumbnail))) fs.unlinkSync(path.join("thumbnails", row.thumbnail));

    db.run("DELETE FROM videos WHERE id=?", [id], (err)=>{
      if(err) return res.send(err.message);
      res.redirect("/");
    });
  });
});

// --- API ---
// Video list
// Get all videos (Protected)
app.get("/api/videos", apiKeyMiddleware, (req, res) => {
  db.all("SELECT id,title,thumbnail FROM videos ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    rows.forEach(r => {
      r.thumbnail_url = `/api/videos/${r.id}/thumb`;
      r.stream_url = `/api/videos/${r.id}/stream`; // ใช้ได้เลย
    });

    res.json(rows);
  });
});

// Get thumbnail (Protected)
app.get("/api/videos/:id/thumb", apiKeyMiddleware, (req, res) => {
  const id = req.params.id;
  const file = path.join(__dirname, "thumbnails", `${id}.jpg`);
  res.sendFile(file);
});


// Video streaming
// Video Streaming (NO API KEY)
app.get("/api/videos/:id/stream", (req, res) => {
  const id = req.params.id;

  db.get("SELECT filename FROM videos WHERE id=?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Video not found" });

    const videoPath = path.join(__dirname, "videos", row.filename);

    fs.stat(videoPath, (err, stats) => {
      if (err) return res.status(404).json({ error: "File missing" });

      const range = req.headers.range;
      if (!range) {
        return res.status(416).send("Range header required");
      }

      const videoSize = stats.size;
      const chunkSize = 10 ** 6; // 1MB chunk
      const start = Number(range.replace(/\D/g, ""));
      const end = Math.min(start + chunkSize, videoSize - 1);

      const headers = {
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      };

      res.writeHead(206, headers);
      fs.createReadStream(videoPath, { start, end }).pipe(res);
    });
  });
});

// Thumbnail API
app.get("/api/videos/:id/thumb",apiKeyMiddleware, (req,res)=>{
  const id = req.params.id;
  db.get("SELECT thumbnail FROM videos WHERE id=?", [id], (err,row)=>{
    if(err) return res.status(500).send(err.message);
    if(!row || !row.thumbnail) return res.status(404).send("Thumbnail not found");

    const thumbPath = path.join(__dirname,"thumbnails", row.thumbnail);
    if(!fs.existsSync(thumbPath)) return res.status(404).send("Thumbnail missing");

    res.sendFile(thumbPath);
  });
});

// Thumbnail fullscreen view
app.get("/thumbnail/:id", (req,res)=>{
  const id = req.params.id;
  db.get("SELECT thumbnail, title FROM videos WHERE id=?", [id], (err,row)=>{
    if(err) return res.send(err.message);
    if(!row || !row.thumbnail) return res.status(404).send("Thumbnail not found");
    res.render("thumbnail", { media: row });
  });
});


const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server running: http://localhost:${port}`));
