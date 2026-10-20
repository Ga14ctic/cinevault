import { Readable } from "node:stream";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Client for the internal tmdb-embed-api aggregator plus a reverse proxy so the
// browser can play the returned HLS/MP4 URLs through our own origin (avoids
// mixed-content blocking, X-Frame-Options, and referer/origin checks upstream).

const PROXY_PATHS = ["m3u8-proxy", "ts-proxy", "sub-proxy"];

export function embedApiConfigured() {
  return Boolean(config.embedApiUrl);
}

// Aggregator emits proxy URLs pointing at its own host (it ignores
// X-Forwarded-Host). Rewrite them to a same-origin path we proxy.
function rewriteStreamUrl(url) {
  if (typeof url !== "string") return url;
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/^\//, "");
    if (PROXY_PATHS.some((p) => seg.startsWith(p))) {
      return `/embed-proxy/${seg}${u.search}`;
    }
  } catch {
    // not a URL — leave as-is
  }
  return url;
}

// Map a CineVault stream object's url (and subtitle urls) onto our proxy.
function rewriteStream(stream) {
  if (!stream || typeof stream !== "object") return stream;
  const out = { ...stream, url: rewriteStreamUrl(stream.url) };
  if (Array.isArray(stream.subtitles)) {
    out.subtitles = stream.subtitles.map((s) => ({
      ...s,
      url: rewriteStreamUrl(s.url),
    }));
  }
  return out;
}

// type: "movie" | "tv" (CineVault) -> aggregator wants "movie" | "series"
export async function fetchStreams({ type, tmdbId, season, episode }) {
  if (!embedApiConfigured()) {
    const err = new Error("Stream aggregator not configured");
    err.status = 503;
    err.code = "NO_EMBED_API";
    throw err;
  }
  const aggType = type === "tv" ? "series" : "movie";
  const url = new URL(`${config.embedApiUrl}/api/streams/${aggType}/${tmdbId}`);
  if (type === "tv") {
    url.searchParams.set("season", String(season ?? 1));
    url.searchParams.set("episode", String(episode ?? 1));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`Aggregator ${res.status}`);
      err.status = 502;
      throw err;
    }
    const data = await res.json();
    const streams = (data.streams || []).map(rewriteStream);
    return { streams, providerTimings: data.providerTimings || {} };
  } finally {
    clearTimeout(timer);
  }
}

// Reverse-proxy a request through to the aggregator's proxy endpoint.
// For HLS manifests (m3u8-proxy) we rewrite the body so nested playlist/segment
// URLs point back through us instead of at the internal aggregator host.
export async function proxyEmbedRequest(req, res, subPath) {
  if (!embedApiConfigured()) {
    return res.status(503).json({ error: { code: "NO_EMBED_API", message: "Stream aggregator not configured" } });
  }
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  const target = `${config.embedApiUrl}/${subPath}${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const upstream = await fetch(target, {
      signal: ctrl.signal,
      headers: {
        // Pass range through for ts-proxy seek support.
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
    });
    const isManifest = subPath.startsWith("m3u8-proxy");
    const ctype = upstream.headers.get("content-type") || (isManifest ? "application/vnd.apple.mpegurl" : "application/octet-stream");

    if (isManifest) {
      let body = await upstream.text();
      // Rewrite internal aggregator URLs (nested playlists/segments/audio) to
      // same-origin /embed-proxy paths.
      body = body.replace(
        /(https?:\/\/[^/\s]+)?\/?(m3u8-proxy|ts-proxy|sub-proxy)\?/g,
        "/embed-proxy/$2?"
      );
      // Some providers emit absolute CDN URLs for segments (often with a
      // non-media extension). Route those through ts-proxy too so the browser
      // never hits the CDN directly (avoids CORS/mixed-content/referer checks).
      body = body.replace(/^(https?:\/\/\S+)$/gm, (m) => {
        if (m.includes("/embed-proxy/")) return m;
        return `/embed-proxy/ts-proxy?url=${encodeURIComponent(m)}`;
      });
      res.status(upstream.status).setHeader("Content-Type", ctype);
      res.setHeader("Cache-Control", "no-store");
      return res.send(body);
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", ctype);
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) res.setHeader("Accept-Ranges", ar);
    res.setHeader("Cache-Control", "no-store");

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    logger.warn({ err, subPath }, "embed proxy failed");
    if (!res.headersSent) {
      res.status(502).json({ error: { code: "UPSTREAM", message: "Stream proxy error" } });
    }
  } finally {
    clearTimeout(timer);
  }
}
