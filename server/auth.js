import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { col } from "./db.js";
import { config } from "./config.js";

const BCRYPT_COST = 12;

export const MOVIE_RATINGS = ["G", "PG", "PG-13", "R", "NC-17"];
export const TV_RATINGS = ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"];

export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

export function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase();
}

export function validateUsername(name) {
  return typeof name === "string" && USERNAME_RE.test(name);
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  if (typeof hash !== "string" || !hash.startsWith("$2")) return Promise.resolve(false);
  return bcrypt.compare(password, hash).catch(() => false);
}

export function safeHashEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function expiresInDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function ensureIndexes() {
  await col("users").createIndex({ username: 1 }, { unique: true });
  await col("sessions").createIndex({ tokenHash: 1 }, { unique: true });
  await col("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await col("sessions").createIndex({ userId: 1 });
}

export async function seedRootUser() {
  const count = await col("users").countDocuments();
  if (count > 0) return { seeded: false };

  const username = normalizeUsername(config.rootUser);
  const passwordHash = await hashPassword(config.rootPass);
  await col("users").insertOne({
    username,
    passwordHash,
    role: "root",
    caps: { movie: "NC-17", tv: "TV-MA" },
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { seeded: true, generated: !!config.rootPassGenerated };
}

export async function createSession(user, req) {
  const raw = newSessionToken();
  await col("sessions").insertOne({
    tokenHash: hashToken(raw),
    userId: user._id,
    userAgent: String(req?.get?.("user-agent") || "").slice(0, 256),
    ip: String(req?.ip || "").slice(0, 64),
    createdAt: new Date(),
    expiresAt: expiresInDays(config.sessionDays),
    revokedAt: null,
  });
  return raw;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  };
}

export async function revokeSession(raw) {
  if (!raw) return;
  await col("sessions").updateOne(
    { tokenHash: hashToken(raw), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function revokeAllForUser(userId) {
  await col("sessions").updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    caps: user.caps || { movie: "PG-13", tv: "TV-14" },
    active: user.active !== false,
  };
}

export function validCaps(caps) {
  if (!caps || typeof caps !== "object") return null;
  const movie = String(caps.movie || "PG");
  const tv = String(caps.tv || "TV-PG");
  if (!MOVIE_RATINGS.includes(movie) || !TV_RATINGS.includes(tv)) return null;
  return { movie, tv };
}
