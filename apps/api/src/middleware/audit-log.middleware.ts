import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { AuditLogModel } from "../models/audit-log.model.js";
import { logger } from "../lib/logger.js";

type AuditMeta = {
  action?: string;
  resource?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  username?: string;
  role?: string;
};

export function setAuditMeta(res: Response, meta: AuditMeta) {
  const current = (res.locals.auditMeta as AuditMeta | undefined) ?? {};
  res.locals.auditMeta = { ...current, ...meta };
}

export function auditLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api") || req.path.startsWith("/api/health")) {
    return next();
  }

  res.on("finish", () => {
    const requestId = (res.locals.requestId as string | undefined) ?? "unknown";
    const routePath = req.route?.path;
    const auditMeta = (res.locals.auditMeta as AuditMeta | undefined) ?? {};

    const auth = req.auth;
    const userId = auditMeta.userId ?? auth?.userId;

    const payload = {
      requestId,
      userId: userId && mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : undefined,
      username: auditMeta.username,
      role: auditMeta.role ?? auth?.activeRole,
      action: auditMeta.action ?? `${req.method}_REQUEST`,
      resource: auditMeta.resource ?? (typeof routePath === "string" ? routePath : req.path),
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: auditMeta.metadata
    };

    void AuditLogModel.create(payload).catch((error) => {
      logger.warn("Failed to persist audit log", {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  return next();
}
