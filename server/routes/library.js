import express from "express";
import { col } from "../db.js";
import { requireAuth } from "../middleware.js";
import { capsFilterFor, mergeFilter } from "../caps.js";

const router = express.Router();

const CARD_FIELDS = {
  key: 1,
  media_type: 1,
  tmdb_id: 1,
  title: 1,
  year: 1,
  poster_path: 1,
  rating: 1,
  vote_average: 1,
  genre_names: 1,
  local: 1,
  _id: 0,
};

function cardQuery() {
  return col("titles").find({}, { projection: CARD_FIELDS });
}
async function row(user, id, title, filter, sort, limit = 20) {
  const q = mergeFilter(filter, capsFilterFor(user));
  const items = await col("titles")
    .find(q, { projection: CARD_FIELDS })
    .sort(sort)
    .limit(limit)
    .toArray();
  return { id, title, items };
}

router.get("/rows", requireAuth, async (req, res) => {
  const user = req.user;

  const continueItems = (await col("progress")
    .aggregate([
      { $match: { userId: user._id, watched: false, percent: { $gt: 0.01, $lt: 0.99 } } },
      { $sort: { updatedAt: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: "titles",
          localField: "titleKey",
          foreignField: "key",
          as: "title",
        },
      },
      { $unwind: "$title" },
      {
        $project: {
          _id: 0,
          titleKey: 1,
          season: 1,
          episode: 1,
          percent: 1,
          seconds: 1,
          duration: 1,
          "title.key": 1,
          "title.media_type": 1,
          "title.tmdb_id": 1,
          "title.title": 1,
          "title.year": 1,
          "title.poster_path": 1,
          "title.rating": 1,
          "title.vote_average": 1,
          "title.genre_names": 1,
          "title.local": 1,
        },
      },
    ])
    .toArray()).map((p) => ({
    ...p.title,
    progress: { percent: p.percent, seconds: p.seconds, duration: p.duration, season: p.season, episode: p.episode },
  }));

  const continueFiltered = continueItems.filter((t) => {
    if (user.role === "root") return true;
    const caps = user.caps;
    const list = t.media_type === "tv" ? ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"] : ["G", "PG", "PG-13", "R", "NC-17"];
    const cap = t.media_type === "tv" ? caps?.tv : caps?.movie;
    if (t.rating == null) return true;
    const tr = list.indexOf(t.rating);
    const cr = list.indexOf(cap);
    if (tr === -1) return true;
    return cr !== -1 && tr <= cr;
  });

  const genreCounts = await col("titles")
    .aggregate([
      { $match: mergeFilter({}, capsFilterFor(user)) },
      { $unwind: "$genres" },
      { $group: { _id: "$genres", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ])
    .toArray();

  const genreNames = await col("titles").findOne({ genres: { $in: genreCounts.map((g) => g._id) } }, { projection: { genre_names: 1, genres: 1 } });
  const gidToName = {};
  if (genreNames) {
    (genreNames.genres || []).forEach((g, i) => {
      const n = genreNames.genre_names?.[i];
      if (n) gidToName[g] = n;
    });
  }
  const genreList = await col("titles")
    .aggregate([
      { $unwind: { path: "$genres", includeArrayIndex: "idx" } },
      { $project: { gid: "$genres", name: { $arrayElemAt: ["$genre_names", "$idx"] } } },
      { $group: { _id: "$gid", name: { $first: "$name" } } },
    ])
    .toArray();
  const nameById = {};
  for (const g of genreList) nameById[g._id] = g.name;

  const rows = [];
  if (continueFiltered.length) {
    rows.push({ id: "continue", title: "Continue Watching", items: continueFiltered });
  }
  rows.push(
    await row(user, "trending", "Trending Now", { popularity: { $gt: 0 } }, { popularity: -1 }),
    await row(user, "popular-movies", "Popular Movies", { media_type: "movie" }, { popularity: -1 }),
    await row(user, "popular-tv", "Popular TV", { media_type: "tv" }, { popularity: -1 }),
    await row(user, "top-rated", "Top Rated", { vote_average: { $gt: 7.5 }, "vote_count": { $gte: 500 } }, { vote_average: -1 })
  );

  for (const g of genreCounts.slice(0, 6)) {
    if (nameById[g._id]) {
      rows.push(await row(user, `genre:${g._id}`, nameById[g._id], { genres: g._id }, { popularity: -1 }, 20));
    }
  }

  rows.push(
    await row(user, "new-movies", "New Releases", { media_type: "movie", year: { $gte: 2023 } }, { year: -1 }),
    await row(user, "classics", "Classics", { year: { $lte: 1990 } }, { vote_average: -1 })
  );

  const localItems = await col("titles")
    .find(mergeFilter({ source: "upload" }, capsFilterFor(user)), { projection: CARD_FIELDS })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  if (localItems.length) rows.push({ id: "local", title: "Your Uploads", items: localItems });

  res.json({ rows: rows.filter((r) => r.items.length > 0) });
});

router.get("/library", requireAuth, async (req, res) => {
  const { q, type, genre, decade, sort } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

  let filter = {};
  if (type === "movie" || type === "tv") filter.media_type = type;
  if (genre) filter.genres = Number(genre);
  if (decade) {
    const d = Number(decade);
    if (!Number.isNaN(d)) filter.year = { $gte: d, $lte: d + 9 };
  }
  if (q) filter.$text = { $search: String(q).slice(0, 80) };

  const sortMap = {
    popularity: { popularity: -1 },
    rating: { vote_average: -1 },
    newest: { year: -1 },
    oldest: { year: 1 },
    title: { title: 1 },
  };
  const sortSpec = sortMap[sort] || (q ? { score: { $meta: "textScore" } } : { popularity: -1 });

  const merged = mergeFilter(filter, capsFilterFor(req.user));
  const total = await col("titles").countDocuments(merged);
  const items = await col("titles")
    .find(merged, { projection: CARD_FIELDS })
    .sort(sortSpec)
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
});

router.get("/titles/:key", requireAuth, async (req, res) => {
  const merged = mergeFilter({ key: req.params.key }, capsFilterFor(req.user));
  const title = await col("titles").findOne(merged);
  if (!title) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Title not found" } });
  }
  const local = title.local ? { ...title.local, url: `/media/${title.local.filename}` } : null;
  res.json({ title: { ...title, _id: undefined, local } });
});

router.get("/genres", requireAuth, async (req, res) => {
  const list = await col("titles")
    .aggregate([
      { $match: mergeFilter({}, capsFilterFor(req.user)) },
      { $unwind: { path: "$genres", includeArrayIndex: "idx" } },
      { $project: { gid: "$genres", name: { $arrayElemAt: ["$genre_names", "$idx"] } } },
      { $group: { _id: "$gid", name: { $first: "$name" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  res.json({ genres: list.filter((g) => g.name).map((g) => ({ id: g._id, name: g.name, count: g.count })) });
});

export default router;
