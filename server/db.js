import { MongoClient } from "mongodb";
import { config } from "./config.js";
import { logger } from "./logger.js";

let client = null;
let db = null;

export async function connectDb() {
  client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(config.mongoDb);
  logger.info({ db: config.mongoDb }, "mongo connected");
  return db;
}

export function getDb() {
  if (!db) throw new Error("database not connected yet");
  return db;
}

export function col(name) {
  return getDb().collection(name);
}

export async function closeDb() {
  if (client) await client.close();
}
