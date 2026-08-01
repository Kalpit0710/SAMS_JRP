import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import mongoose from "mongoose";

async function bootstrap() {
  await connectDb(env.MONGODB_URI);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info("SAMS API started", {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      version: env.APP_VERSION
    });
  });

  const shutdown = (signal: string) => {
    logger.info("SAMS API shutdown requested", { signal });
    server.close(async (error) => {
      await mongoose.disconnect();
      if (error) {
        logger.error("SAMS API shutdown failed", { message: error.message });
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  logger.error("Failed to start SAMS API", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
