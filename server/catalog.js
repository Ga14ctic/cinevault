import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { col, getDb } from "./db.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(ROOT, "data", "catalog.json");

export async function ensureTitleIndexes() {
  const titles = col("titles");
  await titles.createIndex({ key: 1 }, { unique: true });
  await titles.createIndex({ media_type: 1, popularity: -1 });
  await titles.createIndex({ vote_average: -1 });
  await titles.createIndex({ genres: 1 });
  await titles.createIndex({ year: -1 });
  await titles.createIndex({ popularity: -1 });
  await titles.createIndex({ source: 1 });
  await titles.createIndex(
    { title: "text", original_title: "text" },
    { name: "title_text", weights: { title: 10, original_title: 5 } }
  );
}

export async function importCatalogIfEmpty() {
  const count = await col("titles").countDocuments();
  if (count > 0) {
    logger.info({ titles: count }, "catalog already present, skipping import");
    return { imported: false, count };
  }
  if (!fs.existsSync(CATALOG)) {
    logger.warn("no data/catalog.json found; library will be empty until seeded");
    return { imported: false, count: 0 };
  }

  const raw = fs.readFileSync(CATALOG, "utf8");
  let docs;
  try {
    docs = JSON.parse(raw);
  } catch (err) {
    logger.error({ err }, "catalog.json is not valid JSON; skipping import");
    return { imported: false, count: 0 };
  }
  if (!Array.isArray(docs) || docs.length === 0) {
    logger.warn("catalog.json empty");
    return { imported: false, count: 0 };
  }

  const now = new Date();
  const titles = col("titles");
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const ops = docs.slice(i, i + CHUNK).map((doc) => ({
      updateOne: {
        filter: { key: doc.key },
        update: {
          $set: { ...doc, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    }));
    const result = await titles.bulkWrite(ops, { ordered: false });
    written += (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
    process.stdout.write(`\r  importing titles: ${Math.min(i + CHUNK, docs.length)}/${docs.length}`);
  }
  process.stdout.write("\n");

  const final = await titles.countDocuments();
  logger.info({ imported: final }, "catalog imported from data/catalog.json");
  return { imported: true, count: final };
}

export async function ensurePrefs() {
  const existing = await getDb().collection("prefs").findOne({ _id: "singleton" });
  if (existing) return existing;
  const doc = {
    _id: "singleton",
    tmdbKey: "",
    siteName: "CineVault",
    accentColor: "#e50914",
    uploadMaxGb: 50,
    seededAt: null,
    updatedAt: new Date(),
  };
  await getDb().collection("prefs").insertOne(doc);
  return doc;
}
