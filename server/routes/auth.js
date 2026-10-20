import express from "express";
import { col } from "../db.js";
import {
  normalizeUsername,
  verifyPassword,
  createSession,
  revokeSession,
  revokeAllForUser,
  sessionCookieOptions,
  publicUser,
} from "../auth.js";
import { loginLimiter, sessionCookieName, requireAuth } from "../middleware.js";
import { logger } from "../logger.js";

const router = express.Router();

router.post("/login", loginLimiter, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: { code: "BAD_REQUEST", message: "Username and password are required" } });
  }

  const user = await col("users").findOne({ username });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !ok || user.active === false) {
    return res
      .status(401)
      .json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" } });
  }

  const raw = await createSession(user, req);
  res.cookie(sessionCookieName(), raw, sessionCookieOptions());
  logger.info({ username }, "login ok");
  res.json({ user: publicUser(user) });
});

router.post("/logout", async (req, res) => {
  const raw = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${sessionCookieName()}=`))
    ?.slice(sessionCookieName().length + 1);
  if (raw) await revokeSession(decodeURIComponent(raw));
  res.clearCookie(sessionCookieName(), { path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
