import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server.js";

function createPoolMock() {
  let nextTodoId = 1;
  let nextMessageId = 1;
  const todos = [];
  const messages = [];

  return {
    todos,
    messages,
    async query(sql) {
      if (sql.includes("FROM todos")) return [todos];
      if (sql.includes("FROM messages")) return [messages];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      if (sql.includes("INSERT INTO todos")) {
        const row = {
          id: nextTodoId++,
          title: params[0],
          file_url: params[1],
          created_at: new Date("2026-11-19T09:00:00.000Z")
        };
        todos.unshift(row);
        return [{ insertId: row.id }];
      }
      if (sql.includes("SELECT id, title, file_url")) {
        const row = todos.find((item) => item.id === params[0]);
        return [row ? [row] : []];
      }
      if (sql.includes("INSERT INTO messages")) {
        const row = {
          id: nextMessageId++,
          to_email: params[0],
          cc_email: params[1],
          bcc_email: params[2],
          subject: params[3],
          body: params[4],
          direction: "sent",
          status: "sent",
          created_at: new Date("2026-11-19T09:05:00.000Z")
        };
        messages.unshift(row);
        return [{ insertId: row.id }];
      }
      if (sql.includes("SELECT id, to_email")) {
        const row = messages.find((item) => item.id === params[0]);
        return [row ? [row] : []];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    }
  };
}

function createHarness({ snsError = null, snsTopic = null } = {}) {
  const pool = createPoolMock();
  const s3Calls = [];
  const sesCalls = [];
  const snsCalls = [];

  const app = createApp({
    pool,
    env: {
      FRONTEND_URL: "http://localhost:5173",
      AWS_S3_BUCKET: "test-bucket",
      SES_FROM_EMAIL: "sender@example.com",
      AWS_SNS_TOPIC_ARN: snsTopic
    },
    s3: { send: async (command) => s3Calls.push(command.input) },
    ses: { send: async (command) => sesCalls.push(command.input) },
    sns: {
      send: async (command) => {
        snsCalls.push(command.input);
        if (snsError) throw snsError;
      }
    }
  });

  return { app, pool, s3Calls, sesCalls, snsCalls };
}

test("health and todo/message listings", async () => {
  const { app } = createHarness();

  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: "ok" });

  const todos = await request(app).get("/api/todos");
  assert.equal(todos.status, 200);
  assert.deepEqual(todos.body, []);

  const messages = await request(app).get("/api/messages");
  assert.equal(messages.status, 200);
  assert.deepEqual(messages.body, []);
});

test("todo validation, create without file, and create with file", async () => {
  const harness = createHarness();

  const missingTitle = await request(harness.app).post("/api/todos").field("title", " ");
  assert.equal(missingTitle.status, 400);

  const withoutFile = await request(harness.app).post("/api/todos").field("title", "Plan");
  assert.equal(withoutFile.status, 201);
  assert.equal(withoutFile.body.title, "Plan");
  assert.equal(withoutFile.body.file_url, null);

  const withFile = await request(harness.app)
    .post("/api/todos")
    .field("title", "Upload")
    .attach("file", Buffer.from("hello"), "note.txt");
  assert.equal(withFile.status, 201);
  assert.match(withFile.body.file_url, /^s3:\/\/test-bucket\/todos\//);
  assert.equal(harness.s3Calls.length, 1);
});

test("todo file size limit returns 400", async () => {
  const harness = createHarness();
  const response = await request(harness.app)
    .post("/api/todos")
    .field("title", "Too large")
    .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), "large.bin");
  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Files must be 10 MB or smaller.");
});

test("message validation and comma-separated recipient parsing", async () => {
  const harness = createHarness({ snsTopic: "arn:aws:sns:ap-south-1:123456789012:test" });

  for (const payload of [
    { subject: "Subject", body: "Body" },
    { to: "to@example.com", body: "Body" },
    { to: "to@example.com", subject: "Subject" }
  ]) {
    const response = await request(harness.app).post("/api/messages").send(payload);
    assert.equal(response.status, 400);
  }

  const invalidEmail = await request(harness.app).post("/api/messages").send({
    to: "not-an-email",
    subject: "Subject",
    body: "Body"
  });
  assert.equal(invalidEmail.status, 400);

  const sent = await request(harness.app).post("/api/messages").send({
    to: " one@example.com, two@example.com ",
    cc: "cc@example.com",
    bcc: " blind@example.com ",
    subject: "Test subject",
    body: "Test body"
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.to_email, "one@example.com, two@example.com");
  assert.equal(sent.body.cc_email, "cc@example.com");
  assert.equal(sent.body.bcc_email, "blind@example.com");
  assert.equal(sent.body.sns.status, "triggered");
  assert.equal(harness.sesCalls.length, 1);
  assert.deepEqual(harness.sesCalls[0].Destination.ToAddresses, ["one@example.com", "two@example.com"]);
  assert.deepEqual(harness.sesCalls[0].Destination.CcAddresses, ["cc@example.com"]);
  assert.deepEqual(harness.sesCalls[0].Destination.BccAddresses, ["blind@example.com"]);
  assert.equal(harness.snsCalls.length, 1);
  assert.equal(JSON.parse(harness.snsCalls[0].Message).subject, "Test subject");
});

test("missing SNS topic is reported without failing the message", async () => {
  const harness = createHarness();
  const response = await request(harness.app).post("/api/messages").send({
    to: "one@example.com",
    subject: "No SNS",
    body: "Stored and sent"
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.sns.status, "skipped");
  assert.equal(harness.snsCalls.length, 0);
});

test("SNS publish failure is reported without failing the message", async () => {
  const harness = createHarness({
    snsTopic: "arn:aws:sns:ap-south-1:123456789012:test",
    snsError: new Error("offline")
  });
  const response = await request(harness.app).post("/api/messages").send({
    to: "one@example.com",
    subject: "SNS failure",
    body: "Stored and sent"
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.sns.status, "failed");
  assert.equal(harness.pool.messages.length, 1);
});
