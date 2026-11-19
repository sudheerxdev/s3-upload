import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

const defaultPool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10
});

const awsRegion = process.env.AWS_REGION || "ap-south-1";
const defaultS3 = new S3Client({ region: awsRegion });
const defaultSes = new SESClient({ region: awsRegion });
const defaultSns = new SNSClient({ region: awsRegion });

function parseEmailList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createApp({
  pool = defaultPool,
  s3 = defaultS3,
  ses = defaultSes,
  sns = defaultSns,
  env = process.env
} = {}) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  app.use(cors({ origin: env.FRONTEND_URL || "http://localhost:5173" }));
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
      if (!env.AWS_S3_BUCKET) {
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
      fileUrl = `s3://${env.AWS_S3_BUCKET}/${key}`;
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

app.get("/api/messages", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, to_email, cc_email, bcc_email, subject, body, direction, status, created_at FROM messages ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages", async (req, res, next) => {
  const to = parseEmailList(req.body.to);
  const cc = parseEmailList(req.body.cc);
  const bcc = parseEmailList(req.body.bcc);
  const subject = req.body.subject?.trim();
  const body = req.body.body?.trim();

  if (to.length === 0) {
    return res.status(400).json({ message: "At least one recipient is required." });
  }
  if ([...to, ...cc, ...bcc].some((email) => !isValidEmail(email))) {
    return res.status(400).json({ message: "One or more email addresses are invalid." });
  }
  if (!subject) {
    return res.status(400).json({ message: "A subject is required." });
  }
  if (!body) {
    return res.status(400).json({ message: "A message body is required." });
  }
  if (!env.SES_FROM_EMAIL) {
    return res.status(500).json({ message: "SES is not configured." });
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Source: env.SES_FROM_EMAIL,
        Destination: {
          ToAddresses: to,
          CcAddresses: cc,
          BccAddresses: bcc
        },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: body, Charset: "UTF-8" }
          }
        }
      })
    );

    const [result] = await pool.execute(
      "INSERT INTO messages (to_email, cc_email, bcc_email, subject, body, direction, status) VALUES (?, ?, ?, ?, ?, 'sent', 'sent')",
      [to.join(", "), cc.length ? cc.join(", ") : null, bcc.length ? bcc.join(", ") : null, subject, body]
    );
    const [rows] = await pool.execute(
      "SELECT id, to_email, cc_email, bcc_email, subject, body, direction, status, created_at FROM messages WHERE id = ?",
      [result.insertId]
    );

    const createdMessage = rows[0];
    let snsStatus = {
      status: "skipped",
      message: "SNS notification is not configured."
    };

    if (env.AWS_SNS_TOPIC_ARN) {
      try {
        await sns.send(
          new PublishCommand({
            TopicArn: env.AWS_SNS_TOPIC_ARN,
            Subject: "Message sent",
            Message: JSON.stringify({
              id: createdMessage.id,
              to: parseEmailList(req.body.to),
              cc: parseEmailList(req.body.cc),
              bcc: parseEmailList(req.body.bcc),
              subject: createdMessage.subject,
              sentAt: createdMessage.created_at
            })
          })
        );
        snsStatus = { status: "triggered", message: "SNS alert triggered." };
      } catch (snsError) {
        console.error("SNS notification failed:", snsError.message || snsError);
        snsStatus = { status: "failed", message: "SNS alert could not be delivered." };
      }
    }

    res.status(201).json({ ...createdMessage, sns: snsStatus });
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

  return app;
}

const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = createApp();
  app.listen(Number(process.env.PORT || 5000), () => {
    console.log(`Todo API listening on http://localhost:${process.env.PORT || 5000}`);
  });
}
