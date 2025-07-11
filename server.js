import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const __dirname = path.resolve();
const uploadsDir = path.join(__dirname, "uploads");
const tempDir = path.join(__dirname, "temp");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(uploadsDir, req.body.uploadId);
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `chunk_${req.body.index}`);
  }
});

const upload = multer({ storage });

app.post("/chunk", upload.single("chunk"), (req, res) => {
  const { uploadId, index } = req.body;
  if (!uploadId || typeof index === "undefined") {
    return res.status(400).json({ error: "Missing uploadId or index" });
  }

  res.json({ message: `Chunk ${index} for ${uploadId} received.` });
});

app.post("/finish", async (req, res) => {
  try {
    const {
      uploadId,
      filename,
      userhash,
      destination = "catbox",
      time = "1h"
    } = req.body;

    const chunkDir = path.join(uploadsDir, uploadId);
    const finalFilePath = path.join(tempDir, `${uploadId}-${filename}`);

    if (!fs.existsSync(chunkDir)) {
      return res.status(400).json({ error: "No chunks found for this uploadId" });
    }

    const chunkFiles = fs
      .readdirSync(chunkDir)
      .filter((f) => f.startsWith("chunk_"))
      .sort((a, b) => {
        const aIndex = parseInt(a.split("_")[1]);
        const bIndex = parseInt(b.split("_")[1]);
        return aIndex - bIndex;
      });

    const writeStream = fs.createWriteStream(finalFilePath);
    for (const chunk of chunkFiles) {
      const chunkPath = path.join(chunkDir, chunk);
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
    }
    writeStream.end();

    await new Promise((resolve) => writeStream.on("finish", resolve));

    const form = new FormData();
    if (destination === "litterbox") {
      form.append("reqtype", "fileupload");
      form.append("time", time);
      form.append("fileToUpload", fs.createReadStream(finalFilePath));

      const response = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
        method: "POST",
        body: form,
        headers: form.getHeaders()
      });

      const result = await response.text();
      return res.json({ url: result });

    } else {
      form.append("reqtype", "fileupload");
      if (userhash) form.append("userhash", userhash);
      form.append("fileToUpload", fs.createReadStream(finalFilePath));

      const response = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: form,
        headers: form.getHeaders()
      });

      const result = await response.text();
      return res.json({ url: result });
    }

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method}:${req.path} not found`, error: "Not Found", statusCode: 404 });
});

app.listen(PORT, () => {
  console.log(`Resumable upload server listening on http://localhost:${PORT}`);
});