import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const readyState = mongoose.connection.readyState;
  const isDbReady = readyState === 1;

  res.status(isDbReady ? 200 : 503).json({
    status: isDbReady ? "healthy" : "degraded",
    service: "SAMS API",
    version: env.APP_VERSION,
    environment: env.NODE_ENV,
    dependencies: {
      mongodb: {
        connected: isDbReady,
        state: readyState
      }
    },
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});
