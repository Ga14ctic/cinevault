import express from "express";
import { col } from "../db.js";
import { requireAuth } from "../middleware.js";
import { capsFilterFor, mergeFilter } from "../caps.js";
import { fetchStreams, embedApiConfigured, proxyEmbedRequest } from "../embed.js";
const router = express.Router();

// GET /api/streams/:key?season=&episode=
// Resolves a catalog title to direct playable stream URLs via the aggregator.
router.get("/streams/:key", requireAuth, async (req, res, next) => {
  try {
    const title = await col("titles").findOne(
      mergeFilter({ key: req.params.key }, capsFilterFor(req.user)),
      { projection: { key: 1, media_type: 1, tmdb_id: 1 } }
    );
    if (!title) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Title not found" } });
    }
    if (!embedApiConfigured()) {
      return res.status(503).json({ error: { code: "NO_EMBED_API", message: "Stream aggregator not configured" } });
    }

    const season = req.query.season ? Number(req.query.season) : null;
    const episode = req.query.episode ? Number(req.query.episode) : null;
    const { streams, providerTimings } = await fetchStreams({
      type: title.media_type === "tv" ? "tv" : "movie",
      tmdbId: title.tmdb_id,
      season,
      episode,
    });
    res.json({ streams, providerTimings });
  } catch (err) {
    next(err);
  }
});

// Same-origin proxy for the aggregator's HLS/segment/subtitle endpoints.
// No requireAuth here: <video>/hls.js requests can't carry extra headers, but
// they DO send session cookies, so we still gate on session presence.
export function embedProxyRouter() {
  const proxy = express.Router();
  proxy.use((req, res, next) => {
    if (!req.session) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Login required" } });
    }
    next();
  });
  for (const sub of ["m3u8-proxy", "ts-proxy", "sub-proxy"]) {
    proxy.get(`/${sub}`, (req, res) => proxyEmbedRequest(req, res, sub));
  }
  return proxy;
}

export default router;
