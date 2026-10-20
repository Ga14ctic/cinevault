import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { col } from "./db.js";
import { loadSession } from "./middleware.js";
import authRoutes from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../client/dist");

export function createApp() {
  const app = express();

  app.set("trust proxy", config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/api/health" },
    })
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://image.tmdb.org", "https://flagcdn.com"],
          frameSrc: ["'self'", "https://cinesrc.st"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(loadSession);

  app.get("/api/health", async (_req, res) => {
    let mongo = "down";
    let titles = 0;
    try {
      await col("titles").findOne({}, { projection: { _id: 1 } });
      mongo = "up";
      titles = await col("titles").countDocuments();
    } catch {
      mongo = "down";
    }
    const ok = mongo === "up";
    res.status(ok ? 200 : 503).json({
      ok,
      mongo,
      titles,
      uptime: Math.round(process.uptime()),
    });
  });

  app.use("/api/auth", authRoutes);

  app.use("/media", (req, res, next) => {
    if (!req.session) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Login required" } });
    next();
  });
  app.use(
    "/media",
    express.static(config.mediaDir || path.resolve(__dirname, "../data/media"), {
      acceptRanges: true,
      fallthrough: false,
      maxAge: 0,
    })
  );

  if (fs.existsSync(distDir)) {
    app.use(
      express.static(distDir, {
        index: false,
        maxAge: config.isProd ? "1h" : 0,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
        },
      })
    );
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown API route" } });
  });

  const spaFallback = (_req, res) => {
    const indexFile = path.join(distDir, "index.html");
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    res.status(503).json({ error: { code: "NO_FRONTEND", message: "Frontend not built" } });
  };
  app.get("/", spaFallback);
  app.get("/*splat", spaFallback);

  app.use((err, _req, res, _next) => {
    if (err?.status === 404 || err?.code === "ENOENT") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } });
    }
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "File exceeds upload limit" } });
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  return app;
}
