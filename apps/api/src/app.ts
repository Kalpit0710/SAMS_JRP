import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { recordRequestMetric } from "./lib/metrics.js";
import { auditLogMiddleware } from "./middleware/audit-log.middleware.js";
import { auditRouter } from "./modules/audit/audit.route.js";
import { attendanceRouter } from "./modules/attendance/attendance.route.js";
import { authRouter } from "./modules/auth/auth.route.js";
import { dataTransferRouter } from "./modules/data-transfer/data-transfer.route.js";
import { masterDataRouter } from "./modules/master-data/master-data.route.js";
import { notificationRouter } from "./modules/notifications/notification.route.js";
import { reportingRouter } from "./modules/reporting/reporting.route.js";
import { healthRouter } from "./routes/health.route.js";
import { metricsRouter } from "./routes/metrics.route.js";

function parseAllowedOrigins(corsOriginConfig: string): string[] {
  return corsOriginConfig
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY);
  const allowedOrigins = parseAllowedOrigins(env.CORS_ORIGIN);
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please retry later" }
  });
  const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many authentication requests, please retry later" }
  });

  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error("CORS blocked for origin"));
      }
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(globalLimiter);

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startAt = process.hrtime.bigint();
    res.setHeader("X-Request-Id", requestId);
    res.locals.requestId = requestId;

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
      const routeKey = `${req.method} ${req.baseUrl || ""}${req.route?.path ?? req.path}`;
      recordRequestMetric(routeKey, durationMs);
    });

    next();
  });

  app.use(
    morgan((tokens, req, res) => {
      const requestId = (res as express.Response).locals.requestId as string | undefined;
      const status = Number(tokens.status(req, res) ?? 0);
      const logPayload = {
        requestId,
        method: tokens.method(req, res),
        path: tokens.url(req, res),
        status,
        responseTimeMs: Number(tokens["response-time"](req, res) ?? 0)
      };

      if (status >= 500) {
        logger.error("HTTP request", logPayload);
      } else if (status >= 400) {
        logger.warn("HTTP request", logPayload);
      } else {
        logger.info("HTTP request", logPayload);
      }

      return "";
    })
  );

  app.use(auditLogMiddleware);

  app.get("/api", (_req, res) => {
    res.json({
      service: "SAMS API",
      version: env.APP_VERSION,
      status: "ok"
    });
  });

  app.use("/api/health", healthRouter);
  app.use("/api/metrics", metricsRouter);
  app.use("/api/auth", authLimiter, authRouter);
  app.use("/api/master-data", masterDataRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/data-transfer", dataTransferRouter);
  app.use("/api/reports", reportingRouter);
  app.use("/api/audit-logs", auditRouter);

  if (env.NODE_ENV === "production") {
    const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));
    app.use(
      express.static(webDistPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        }
      })
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        return next();
      }
      res.setHeader("Cache-Control", "no-store");
      return res.sendFile(`${webDistPath}/index.html`);
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ message: "Route not found" });
  });

  app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(error);
    }

    const requestId = (res.locals.requestId as string | undefined) ?? "unknown";

    // Body-parser failures arrive here as tagged errors; map them before the generic 500.
    const errorType = (error as { type?: string }).type;
    if (errorType === "entity.too.large") {
      return res.status(413).json({ message: "Request body is too large", requestId });
    }
    if (errorType === "entity.parse.failed" || (error instanceof SyntaxError && "body" in error)) {
      return res.status(400).json({ message: "Malformed JSON body", requestId });
    }

    // Map known database-layer errors to controlled 4xx responses so invalid IDs,
    // malformed dates and duplicate keys never surface as an opaque 500 (or leak
    // Mongoose/BSON internals).
    if (error instanceof mongoose.Error.CastError) {
      return res.status(400).json({ message: `Invalid value for ${error.path}`, requestId });
    }

    // Constructing an ObjectId from a malformed string throws a BSONError rather than a
    // Mongoose CastError, so map it here too instead of letting it become a 500.
    if (error.name === "BSONError") {
      return res.status(400).json({ message: "Invalid identifier", requestId });
    }

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({ message: "Validation failed", requestId });
    }

    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({ message: "A record with the same unique value already exists", requestId });
    }

    logger.error("Unhandled API error", {
      requestId,
      message: error.message,
      stack: env.NODE_ENV === "production" ? undefined : error.stack
    });

    res.status(500).json({
      message: "Internal server error",
      requestId,
      details: env.NODE_ENV === "production" ? undefined : error.message
    });
  });

  return app;
}
