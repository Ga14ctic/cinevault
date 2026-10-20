import { randomBytes } from "node:crypto";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

function bool(name, fallback = false) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v === "true" || v === "1";
}

export const config = {
  port: Number(process.env.PORT || 6767),
  mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017",
  mongoDb: process.env.MONGO_DB || "cinevault",
  sessionSecret: required("SESSION_SECRET"),
  sessionDays: 30,
  rootUser: process.env.ROOT_USER || "root",
  rootPass: process.env.ROOT_PASS || null,
  tmdbKeyEnv: process.env.TMDB_API_KEY || null,
  mediaDir: process.env.MEDIA_DIR || null,
  isProd: process.env.NODE_ENV === "production",
  trustProxy: bool("TRUST_PROXY", false),
  csrfSecret: randomBytes(32).toString("hex"),
  // HTTPS: set HTTPS=1 to serve TLS with a self-signed cert (LAN use).
  https: bool("HTTPS", false),
  httpsPort: Number(process.env.HTTPS_PORT || process.env.PORT || 6767),
  // Plain HTTP port to redirect to HTTPS (or serve on, if https disabled).
  httpPort: Number(process.env.HTTP_PORT || process.env.PORT || 6767),
  dataDir: process.env.DATA_DIR || null,
  // Extra hostnames/IPs to include in the self-signed cert's SAN
  // (comma-separated). LAN IPs are auto-detected; add a hostname here too.
  httpsHosts: (process.env.HTTPS_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean),
};

if (!config.rootPass) {
  config.rootPass = randomBytes(9).toString("base64url");
  config.rootPassGenerated = true;
}
