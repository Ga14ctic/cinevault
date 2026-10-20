import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "passwordHash", "tokenHash", "tmdbKey", "febboxToken"],
    censor: "[redacted]",
  },
  ...(config.isProd ? {} : { transport: undefined }),
});
