import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const app = express();
const port = Number(process.env.PORT || 5000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10
});

const s3 = new S3Client({ region: process.env.AWS_REGION });

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/todos", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, title, file_url, created_at FROM todos ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/todos", upload.single("file"), async (req, res, next) => {
  const title = req.body.title?.trim();

  if (!title) {
    return res.status(400).json({ message: "A task title is required." });
  }

  try {
    let fileUrl = null;

    if (req.file) {
      if (!process.env.AWS_S3_BUCKET || !process.env.AWS_REGION) {
        return res.status(500).json({ message: "S3 is not configured." });
      }

      const key = `todos/${randomUUID()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype
        })
      );

      // Keep the object private by default. Generate a presigned URL when downloads are needed.
      fileUrl = `s3://${process.env.AWS_S3_BUCKET}/${key}`;
    }

    const [result] = await pool.execute(
      "INSERT INTO todos (title, file_url) VALUES (?, ?)",
      [title, fileUrl]
    );
    const [rows] = await pool.execute(
      "SELECT id, title, file_url, created_at FROM todos WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ message: "Files must be 10 MB or smaller." });
  }

  console.error(error);
  res.status(500).json({ message: "Something went wrong on the server." });
});

app.listen(port, () => {
  console.log(`Todo API listening on http://localhost:${port}`);
});
