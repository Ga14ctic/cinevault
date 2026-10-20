import express from "express";
import { col } from "../db.js";
import { requireAuth } from "../middleware.js";
import { capsFilterFor, mergeFilter } from "../caps.js";

const router = express.Router();

const AUTO_WATCHED = 0.9;

async function assertVisible(req, titleKey) {
  const merged = mergeFilter({ key: titleKey }, capsFilterFor(req.user));
  const title = await col("titles").findOne(merged, { projection: { key: 1, media_type: 1 } });
  return title;
}

router.get("/progress", requireAuth, async (req, res) => {
  const items = await col("progress")
    .find({ userId: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();
  res.json({ items });
});

router.get("/progress/:key", requireAuth, async (req, res) => {
  const title = await assertVisible(req, req.params.key);
  if (!title) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Title not found" } });
  }
  const query = { userId: req.user._id, titleKey: req.params.key };
  if (title.media_type === "tv") {
    const season = Number(req.query.season);
    const episode = Number(req.query.episode);
    if (Number.isInteger(season) && season > 0) query.season = season;
    if (Number.isInteger(episode) && episode > 0) query.episode = episode;
  }
  const progress = await col("progress").findOne(query, { sort: { updatedAt: -1 } });
  res.json({ progress: progress || null });
});

router.put("/progress", requireAuth, async (req, res) => {
  const { titleKey, season, episode, seconds, duration } = req.body || {};
  if (!titleKey || typeof seconds !== "number" || typeof duration !== "number" || duration <= 0) {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid progress payload" } });
  }
  const title = await assertVisible(req, titleKey);
  if (!title) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Title not found" } });
  }

  const isTv = title.media_type === "tv";
  const percent = Math.min(1, Math.max(0, seconds / duration));
  const watched = percent >= AUTO_WATCHED;

  const filter = {
    userId: req.user._id,
    titleKey,
    season: isTv ? Number(season) || 1 : null,
    episode: isTv ? Number(episode) || 1 : null,
  };

  await col("progress").updateOne(
    filter,
    {
      $set: {
        ...filter,
        seconds: Math.floor(seconds),
        duration: Math.floor(duration),
        percent,
        watched,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  res.json({ ok: true, percent, watched });
});

router.delete("/progress/:key", requireAuth, async (req, res) => {
  const query = { userId: req.user._id, titleKey: req.params.key };
  if (req.query.season) query.season = Number(req.query.season);
  if (req.query.episode) query.episode = Number(req.query.episode);
  await col("progress").deleteMany(query);
  res.json({ ok: true });
});

export default router;
