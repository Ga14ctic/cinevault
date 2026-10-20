import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { connectDb, closeDb } from "./db.js";
import { createApp } from "./app.js";
import { ensureIndexes, seedRootUser } from "./auth.js";
import { ensureTitleIndexes, importCatalogIfEmpty, ensurePrefs } from "./catalog.js";
import { ensureSelfSignedCert } from "./tls.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = config.dataDir || path.join(ROOT, "data");

async function main() {
  await connectDb();
  await ensureIndexes();
  await ensureTitleIndexes();
  await ensurePrefs();
  const seeded = await seedRootUser();
  if (seeded.seeded) {
    logger.info(
      { user: config.rootUser, generated: seeded.generated },
      seeded.generated
        ? "root user created (generated password — see warning below)"
        : "root user created from env credentials"
    );
  }

  const app = createApp();

  const importResult = await importCatalogIfEmpty();
  if (importResult.imported) {
    logger.info({ titles: importResult.count }, "library seeded from catalog.json");
  }

  const servers = [];

  if (config.https) {
    const { key, cert } = await ensureSelfSignedCert(DATA_DIR, config.httpsHosts);
    const httpsServer = https.createServer({ key, cert }, app);
    httpsServer.on("error", (err) => {
      logger.error(
        { port: config.httpsPort, code: err.code },
        err.code === "EADDRINUSE"
          ? `HTTPS port ${config.httpsPort} is already in use — set HTTPS_PORT (and the compose mapping) to a free port`
          : "HTTPS server error"
      );
      process.exit(1);
    });
    httpsServer.listen(config.httpsPort, "0.0.0.0", () => {
      logger.info(`cinevault listening on https://0.0.0.0:${config.httpsPort} (self-signed)`);
    });
    servers.push(httpsServer);

    // Plain HTTP port redirects everything to HTTPS so browsers never sit on
    // the insecure origin (which triggers upgrade/HSTS weirdness). Optional:
    // if the port is busy we log and continue rather than crash.
    if (config.httpPort && config.httpPort !== config.httpsPort) {
      const redirect = http.createServer((req, res) => {
        const host = (req.headers.host || "").replace(/:\d+$/, "");
        const location = `https://${host}:${config.httpsPort}${req.url || "/"}`;
        res.writeHead(301, { Location: location });
        res.end();
      });
      redirect.on("error", (err) => {
        logger.warn(
          { port: config.httpPort, code: err.code },
          "http→https redirect port unavailable; continuing without it"
        );
      });
      redirect.listen(config.httpPort, "0.0.0.0", () => {
        logger.info(`http → https redirect listening on :${config.httpPort}`);
      });
      servers.push(redirect);
    }
  } else {
    const server = app.listen(config.httpPort, "0.0.0.0", () => {
      logger.info(`cinevault listening on :${config.httpPort}`);
    });
    servers.push(server);
  }

  if (config.rootPassGenerated) {
    logger.warn(
      { user: config.rootUser },
      `generated root password (set ROOT_PASS in .env to choose your own): ${config.rootPass}`
    );
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, "shutting down");
    let remaining = servers.length;
    for (const s of servers) {
      s.close(async () => {
        if (--remaining === 0) {
          await closeDb();
          process.exit(0);
        }
      });
    }
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error(err, "fatal boot error");
  process.exit(1);
});
