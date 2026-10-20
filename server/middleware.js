import rateLimit from "express-rate-limit";
import { col } from "./db.js";
import { hashToken } from "./auth.js";

const COOKIE_NAME = "cv_session";

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export async function loadSession(req, _res, next) {
  req.session = null;
  req.user = null;
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return next();

  try {
    const session = await col("sessions").findOne({
      tokenHash: hashToken(raw),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return next();

    const user = await col("users").findOne({ _id: session.userId });
    if (!user || user.active === false) return next();

    req.session = session;
    req.user = user;
  } catch {
    req.session = null;
    req.user = null;
  }
  next();
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Login required" } });
  }
  next();
}

export function requireRoot(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Login required" } });
  }
  if (req.user.role !== "root") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Root access required" } });
  }
  next();
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = String(req.body?.username || "").trim().toLowerCase();
    return `${user}|${req.ip}`;
  },
  message: { error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again in 15 minutes." } },
  statusCode: 429,
  skipSuccessfulRequests: true,
});
