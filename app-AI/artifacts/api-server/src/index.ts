// Sentry must be initialised before any other imports so it can instrument them.
import { initSentry } from "./lib/sentry";
initSentry();

import app from "./app";
import { logger } from "./lib/logger";
import { validateEnv } from "./lib/validateEnv";
import { initRedis } from "./lib/redis";

validateEnv();

const port = Number(process.env["PORT"]);

// Initialise Redis before accepting traffic so the health check is accurate.
// Catch unhandled promise rejections and surface them via structured logs.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

initRedis().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Fatal: failed to initialise Redis");
  process.exit(1);
});
