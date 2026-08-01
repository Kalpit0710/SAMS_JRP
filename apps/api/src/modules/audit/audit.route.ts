import mongoose from "mongoose";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { AuditLogModel } from "../../models/audit-log.model.js";
import { UserModel } from "../../models/user.model.js";

export const auditRouter = Router();

auditRouter.use(requireAuth);

function parsePaging(query: Record<string, unknown>) {
  const pageRaw = typeof query.page === "string" ? Number(query.page) : 1;
  const pageSizeRaw = typeof query.pageSize === "string" ? Number(query.pageSize) : 20;

  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw))) : 20;

  return { page, pageSize };
}

auditRouter.get(
  "/timeline",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePaging(req.query as Record<string, unknown>);

    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const filter: Record<string, unknown> = {};

    if (action) {
      filter.action = action;
    }

    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: "Invalid userId" });
      }
      filter.userId = new mongoose.Types.ObjectId(userId);
    }

    if (from || to) {
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;

      if (fromDate && Number.isNaN(fromDate.getTime())) {
        return res.status(400).json({ message: "Invalid from date" });
      }
      if (toDate && Number.isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid to date" });
      }

      filter.createdAt = {
        ...(fromDate ? { $gte: fromDate } : {}),
        ...(toDate ? { $lte: toDate } : {})
      };
    }

    const [total, items] = await Promise.all([
      AuditLogModel.countDocuments(filter),
      AuditLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
    ]);

    // Most rows only persist userId; resolve the actor so authenticated activity is
    // attributed to a real user instead of the "system" fallback in the UI.
    const unresolvedIds = items
      .filter((item) => !item.username && item.userId)
      .map((item) => item.userId!.toString());

    const userMap = new Map<string, string>();
    if (unresolvedIds.length > 0) {
      const users = await UserModel.find({ _id: { $in: [...new Set(unresolvedIds)] } }).select("username").lean();
      for (const user of users) {
        userMap.set(user._id.toString(), user.username);
      }
    }

    const resolvedItems = items.map((item) => ({
      ...item,
      username: item.username ?? (item.userId ? userMap.get(item.userId.toString()) : undefined)
    }));

    return res.status(200).json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: resolvedItems
    });
  })
);
