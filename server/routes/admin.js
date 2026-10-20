import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import { requireRoot } from "../middleware.js";
import {
  normalizeUsername,
  validateUsername,
  hashPassword,
  publicUser,
  validCaps,
  MOVIE_RATINGS,
  TV_RATINGS,
  revokeAllForUser,
} from "../auth.js";
import { getTmdbKey } from "../tmdb.js";
import { logger } from "../logger.js";

const router = express.Router();

router.use("/admin", requireRoot);

function usernameError(name) {
  return validateUsername(name)
    ? null
    : { error: { code: "BAD_REQUEST", message: "Username must be 3–32 chars: a–z, 0–9, _ . -" } };
}

function passwordError(password) {
  return typeof password === "string" && password.length >= 8
    ? null
    : { error: { code: "BAD_REQUEST", message: "Password must be at least 8 characters" } };
}

router.get("/admin/users", async (_req, res) => {
  const users = await col("users").find().sort({ createdAt: 1 }).toArray();
  const counts = await col("sessions")
    .aggregate([
      { $match: { revokedAt: null, expiresAt: { $gt: new Date() } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ])
    .toArray();
  const sessionCount = {};
  for (const c of counts) sessionCount[String(c._id)] = c.count;
  res.json({
    users: users.map((u) => ({ ...publicUser(u), sessions: sessionCount[String(u._id)] || 0 })),
    ratings: { movie: MOVIE_RATINGS, tv: TV_RATINGS },
  });
});

router.post("/admin/users", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body || {};
  const usrErr = usernameError(username);
  if (usrErr) return res.status(400).json(usrErr);
  const pwdErr = passwordError(password);
  if (pwdErr) return res.status(400).json(pwdErr);

  const caps = validCaps(req.body?.caps) || { movie: "PG-13", tv: "TV-14" };
  const exists = await col("users").findOne({ username }, { projection: { _id: 1 } });
  if (exists) {
    return res.status(409).json({ error: { code: "CONFLICT", message: "Username already taken" } });
  }

  const now = new Date();
  const doc = {
    username,
    passwordHash: await hashPassword(password),
    role: "user",
    caps,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await col("users").insertOne(doc);
  logger.info({ username }, "admin created user");
  res.status(201).json({ user: { ...publicUser({ ...doc, _id: insertedId }), sessions: 0 } });
});

router.patch("/admin/users/:id", async (req, res) => {
  let _id;
  try {
    _id = new ObjectId(req.params.id);
  } catch {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid user id" } });
  }
  const target = await col("users").findOne({ _id });
  if (!target) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }

  const update = { updatedAt: new Date() };

  if (req.body?.password !== undefined) {
    const pwdErr = passwordError(req.body.password);
    if (pwdErr) return res.status(400).json(pwdErr);
    update.passwordHash = await hashPassword(req.body.password);
    await revokeAllForUser(_id);
  }

  if (req.body?.caps !== undefined) {
    const caps = validCaps(req.body.caps);
    if (!caps) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid rating caps" } });
    }
    update.caps = caps;
  }

  if (req.body?.active !== undefined) {
    if (target.role === "root" && req.body.active === false) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Cannot deactivate a root account" } });
    }
    update.active = req.body.active === true;
    if (update.active === false) await revokeAllForUser(_id);
  }

  await col("users").updateOne({ _id }, { $set: update });
  const updated = await col("users").findOne({ _id });
  logger.info({ username: target.username }, "admin updated user");
  res.json({ user: publicUser(updated) });
});

router.delete("/admin/users/:id", async (req, res) => {
  let _id;
  try {
    _id = new ObjectId(req.params.id);
  } catch {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid user id" } });
  }
  if (String(_id) === String(req.user._id)) {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "You cannot delete your own account" } });
  }
  const target = await col("users").findOne({ _id });
  if (!target) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }
  if (target.role === "root") {
    const roots = await col("users").countDocuments({ role: "root" });
    if (roots <= 1) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Cannot delete the last root account" } });
    }
  }
  await col("users").deleteOne({ _id });
  await col("sessions").deleteMany({ userId: _id });
  await col("progress").deleteMany({ userId: _id });
  logger.info({ username: target.username }, "admin deleted user");
  res.json({ ok: true });
});

router.post("/admin/users/:id/revoke-sessions", async (req, res) => {
  let _id;
  try {
    _id = new ObjectId(req.params.id);
  } catch {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid user id" } });
  }
  await revokeAllForUser(_id);
  res.json({ ok: true });
});

const PREF_DEFAULTS = { siteName: "CineVault", accentColor: "#e50914", uploadMaxGb: 50 };

router.get("/admin/prefs", async (_req, res) => {
  const prefs = await col("prefs").findOne({ _id: "singleton" });
  res.json({
    prefs: {
      siteName: prefs?.siteName || PREF_DEFAULTS.siteName,
      accentColor: prefs?.accentColor || PREF_DEFAULTS.accentColor,
      uploadMaxGb: prefs?.uploadMaxGb ?? PREF_DEFAULTS.uploadMaxGb,
      seededAt: prefs?.seededAt || null,
      tmdbKeySet: !!(await getTmdbKey()),
    },
  });
});

router.put("/admin/prefs", async (req, res) => {
  const update = { updatedAt: new Date() };
  const { siteName, accentColor, uploadMaxGb } = req.body || {};

  if (siteName !== undefined) {
    const s = String(siteName).trim().slice(0, 40);
    if (!s) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Site name is required" } });
    update.siteName = s;
  }
  if (accentColor !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(accentColor))) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Accent color must be a #RRGGBB hex" } });
    }
    update.accentColor = String(accentColor).toLowerCase();
  }
  if (uploadMaxGb !== undefined) {
    const gb = Number(uploadMaxGb);
    if (!Number.isFinite(gb) || gb < 1 || gb > 2048) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Upload limit must be 1–2048 GB" } });
    }
    update.uploadMaxGb = Math.round(gb);
  }

  await col("prefs").updateOne({ _id: "singleton" }, { $set: update }, { upsert: true });
  res.json({ ok: true });
});

router.get("/admin/status", async (_req, res) => {
  const [titles, users, local, progress] = await Promise.all([
    col("titles").countDocuments(),
    col("users").countDocuments(),
    col("titles").countDocuments({ source: "upload" }),
    col("progress").countDocuments(),
  ]);
  const byType = await col("titles")
    .aggregate([{ $group: { _id: "$media_type", count: { $sum: 1 } } }])
    .toArray();
  const mediaDir = process.env.MEDIA_DIR;
  const disk = { usedBytes: 0, files: 0 };
  if (mediaDir) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const entries = await fs.readdir(mediaDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const st = await fs.stat(path.join(mediaDir, e.name));
        disk.usedBytes += st.size;
        disk.files++;
      }
    } catch {
      /* media dir not mounted yet */
    }
  }
  res.json({
    titles,
    movies: byType.find((t) => t._id === "movie")?.count || 0,
    tv: byType.find((t) => t._id === "tv")?.count || 0,
    local: local,
    users,
    progressRecords: progress,
    disk,
    uptime: Math.round(process.uptime()),
  });
});

export default router;
