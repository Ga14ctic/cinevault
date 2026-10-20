import { config } from "./config.js";
import { logger } from "./logger.js";
import { connectDb, closeDb } from "./db.js";
import { createApp } from "./app.js";
import { ensureIndexes, seedRootUser } from "./auth.js";
import { ensureTitleIndexes, importCatalogIfEmpty, ensurePrefs } from "./catalog.js";

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

  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info(`cinevault listening on :${config.port}`);
    if (config.rootPassGenerated) {
      logger.warn(
        { user: config.rootUser },
        `generated root password (set ROOT_PASS in .env to choose your own): ${config.rootPass}`
      );
    }
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, "shutting down");
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error(err, "fatal boot error");
  process.exit(1);
});
