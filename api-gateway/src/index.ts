/**
 * ACA API Gateway
 * ===============
 * Single entry point for the UI:
 *   - Reverse-proxies REST calls to individual microservices
 *   - Subscribes to Redis pub/sub and re-emits events via Socket.IO
 *   - Provides a /sse/:jobId endpoint for server-sent events (alternative)
 */

import express, { Request, Response, NextFunction } from "express";
import http from "http";
import cors from "cors";
import morgan from "morgan";
import { Server as IOServer, Socket } from "socket.io";
import { createProxyMiddleware } from "http-proxy-middleware";
import IORedis from "ioredis";
import axios from "axios";

// ── Config ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);
const CONFIG_URL = process.env.CONFIG_SERVICE_URL || "http://localhost:8001";
const JOB_URL = process.env.JOB_MANAGER_URL || "http://localhost:8004";
const RESULTS_URL = process.env.RESULTS_SERVICE_URL || "http://localhost:8005";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ── Express + Socket.IO ────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors({ origin: "*" }));
app.use(morgan("combined"));
// Note: express.json() is applied only to composite endpoints below,
// NOT globally — http-proxy-middleware v3 cannot forward a body that
// body-parser has already consumed.

// ── Redis subscriber ───────────────────────────────────────────────────────

const redisSub = new IORedis(REDIS_URL);

redisSub.on("error", (err) => console.error("[Redis]", err.message));

// Subscribe to all job channels
redisSub.psubscribe("job:*", "jobs:all", (err) => {
  if (err) console.error("[Redis] psubscribe error:", err.message);
  else console.log("[Redis] Subscribed to job channels");
});

redisSub.on("pmessage", (_pattern, channel, message) => {
  try {
    const data = JSON.parse(message);
    const jobId = data.job_id as string;

    // Emit to job-specific room
    io.to(`job:${jobId}`).emit("job_event", data);
    // Emit to the global feed
    io.to("jobs:all").emit("job_event", data);
  } catch {
    // ignore malformed messages
  }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Client subscribes to a specific job
  socket.on("subscribe_job", (jobId: string) => {
    socket.join(`job:${jobId}`);
    socket.emit("subscribed", { jobId });
  });

  socket.on("unsubscribe_job", (jobId: string) => {
    socket.leave(`job:${jobId}`);
  });

  // Client subscribes to all jobs
  socket.on("subscribe_all", () => {
    socket.join("jobs:all");
    socket.emit("subscribed", { channel: "all" });
  });

  socket.on("disconnect", () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── SSE endpoint (alternative to Socket.IO) ───────────────────────────────

app.get("/sse/:jobId", (req: Request, res: Response) => {
  const jobId = req.params.jobId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Create a per-request Redis client (cannot share a psubscribe client)
  const redisClient = new IORedis(REDIS_URL);
  redisClient.subscribe(`job:${jobId}`, (err) => {
    if (err) {
      res.write(`data: ${JSON.stringify({ error: "subscription failed" })}\n\n`);
    }
  });

  redisClient.on("message", (_channel, message) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on("close", () => {
    redisClient.disconnect();
  });
});

// ── Health ─────────────────────────────────────────────────────────────────

app.get("/health", async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};

  const services: [string, string][] = [
    ["config-service", CONFIG_URL],
    ["job-manager", JOB_URL],
    ["results-service", RESULTS_URL],
  ];

  await Promise.all(
    services.map(async ([name, url]) => {
      try {
        await axios.get(`${url}/health`, { timeout: 3000 });
        checks[name] = "ok";
      } catch {
        checks[name] = "unreachable";
      }
    })
  );

  res.json({ status: "ok", service: "api-gateway", upstream: checks });
});

// ── REST proxy routes ──────────────────────────────────────────────────────

// Config Service  →  /api/configs/**
app.use(
  "/api/configs",
  createProxyMiddleware({
    target: CONFIG_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/configs${path === "/" ? "" : path}`,
  })
);

// Job Manager  →  /api/jobs/**
app.use(
  "/api/jobs",
  createProxyMiddleware({
    target: JOB_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/jobs${path === "/" ? "" : path}`,
  })
);

// Results Service  →  /api/results/** and /api/snapshots/**
app.use(
  "/api/results",
  createProxyMiddleware({
    target: RESULTS_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/results${path === "/" ? "" : path}`,
  })
);
app.use(
  "/api/snapshots",
  createProxyMiddleware({
    target: RESULTS_URL,
    changeOrigin: true,
    pathRewrite: (path) => `/snapshots${path === "/" ? "" : path}`,
  })
);

// ── Convenience composite endpoints ───────────────────────────────────────

/** POST /api/runs  – create a job AND immediately start it */
app.post("/api/runs", express.json(), async (req: Request, res: Response) => {
  try {
    const createResp = await axios.post(`${JOB_URL}/jobs`, req.body);
    const job = createResp.data;

    const startResp = await axios.post(`${JOB_URL}/jobs/${job.id}/control`, {
      action: "start",
    });
    res.status(201).json(startResp.data);
  } catch (err: any) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: String(err) });
  }
});

/** GET /api/runs/:jobId  – full job + latest result + recent snapshots */
app.get("/api/runs/:jobId", async (req: Request, res: Response) => {
  const { jobId } = req.params;
  try {
    const [jobResp, snapshotsResp] = await Promise.all([
      axios.get(`${JOB_URL}/jobs/${jobId}`),
      axios.get(`${RESULTS_URL}/snapshots/${jobId}?limit=200`),
    ]);

    let result = null;
    try {
      const resultResp = await axios.get(`${RESULTS_URL}/results/job/${jobId}`);
      result = resultResp.data;
    } catch {
      // no result yet
    }

    res.json({
      job: jobResp.data,
      result,
      snapshots: snapshotsResp.data,
    });
  } catch (err: any) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: String(err) });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[Gateway] Listening on http://0.0.0.0:${PORT}`);
});
