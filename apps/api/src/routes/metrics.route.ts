import { Router } from "express";
import { env } from "../config/env.js";
import { requireAuth, requireRoles } from "../middleware/auth.middleware.js";
import { getMetricsSnapshot, renderMetricsPrometheus } from "../lib/metrics.js";

export const metricsRouter = Router();

// Operational metrics expose route names and latency, so restrict them to admins.
metricsRouter.use(requireAuth, requireRoles(["admin"]));

metricsRouter.get("/", (_req, res) => {
  if (env.NODE_ENV !== "production") {
    return res.status(200).json({ items: getMetricsSnapshot() });
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return res.status(200).send(renderMetricsPrometheus());
});
