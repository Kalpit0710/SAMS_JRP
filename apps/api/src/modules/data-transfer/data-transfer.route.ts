import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { buildCsv, sendCsv } from "../../lib/csv.js";
import { provisionTeacherLogins } from "../../lib/teacher-provisioning.js";
import { logger } from "../../lib/logger.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { ImportLogModel } from "../../models/import-log.model.js";
import { ENTITY_DEFINITIONS, buildTemplate, getEntity, readImportRows } from "./data-transfer.entities.js";

export const dataTransferRouter = Router();

dataTransferRouter.use(requireAuth);

const MAX_IMPORT_ROWS = 2000;

const ImportSchema = z.object({
  csv: z.string().min(1, "csv content is required").max(2_000_000, "File is too large"),
  fileName: z.string().trim().max(200).optional(),
  commit: z.boolean().default(false),
  skipInvalid: z.boolean().default(false)
});

dataTransferRouter.get(
  "/entities",
  requireRoles(["admin"]),
  asyncHandler(async (_req, res) => {
    const items = Object.values(ENTITY_DEFINITIONS).map((entity) => ({
      key: entity.key,
      label: entity.label,
      columns: entity.columns,
      required: entity.required
    }));

    return res.status(200).json({ items });
  })
);

dataTransferRouter.get(
  "/template/:entity",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const entity = getEntity(String(req.params.entity));
    if (!entity) {
      return res.status(404).json({ message: "Unknown entity" });
    }

    return sendCsv(res, `${entity.key}-template.csv`, buildTemplate(entity));
  })
);

dataTransferRouter.get(
  "/export/:entity",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const entity = getEntity(String(req.params.entity));
    if (!entity) {
      return res.status(404).json({ message: "Unknown entity" });
    }

    const rows = await entity.exportRows();
    setAuditMeta(res, {
      action: "DATA_EXPORT",
      resource: "data-transfer",
      metadata: { entity: entity.key, rows: rows.length }
    });

    return sendCsv(res, `${entity.key}-export.csv`, buildCsv(entity.columns, rows));
  })
);

dataTransferRouter.post(
  "/import/:entity",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const entity = getEntity(String(req.params.entity));
    if (!entity) {
      return res.status(404).json({ message: "Unknown entity" });
    }

    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    }

    let rows;
    try {
      rows = readImportRows(parsed.data.csv);
    } catch (error) {
      return res.status(400).json({ message: error instanceof Error ? error.message : "Malformed CSV" });
    }
    if (rows.length === 0) {
      return res.status(400).json({ message: "The file has no data rows" });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ message: `A single import is limited to ${MAX_IMPORT_ROWS} rows` });
    }

    const missingColumns = entity.required.filter((column) => !(column in rows[0]));
    if (missingColumns.length > 0) {
      return res.status(400).json({ message: `Missing required column(s): ${missingColumns.join(", ")}` });
    }

    const { docs, errors } = await entity.build(rows);

    if (!parsed.data.commit) {
      return res.status(200).json({
        preview: true,
        entity: entity.key,
        totalRows: rows.length,
        validCount: docs.length,
        failedCount: errors.length,
        errors: errors.slice(0, 100),
        sample: docs.slice(0, 10)
      });
    }

    if (errors.length > 0 && !parsed.data.skipInvalid) {
      return res.status(422).json({
        message: "Import blocked - fix the highlighted rows or enable 'skip invalid rows'",
        totalRows: rows.length,
        validCount: docs.length,
        failedCount: errors.length,
        errors: errors.slice(0, 100)
      });
    }

    if (docs.length === 0) {
      return res.status(422).json({ message: "No valid rows to import", errors: errors.slice(0, 100) });
    }

    const assignedIds = docs.map(() => new mongoose.Types.ObjectId());
    const payload = docs.map((doc, index) => ({ ...doc, _id: assignedIds[index] }));

    try {
      await entity.model.insertMany(payload, { ordered: true });
    } catch (error) {
      // All-or-nothing: remove anything that made it in before the failure.
      await entity.model.deleteMany({ _id: { $in: assignedIds } });
      logger.error("Import failed and was rolled back", {
        entity: entity.key,
        message: error instanceof Error ? error.message : "unknown error"
      });

      await ImportLogModel.create({
        entity: entity.key,
        fileName: parsed.data.fileName,
        totalRows: rows.length,
        createdCount: 0,
        failedCount: rows.length,
        rowErrors: errors.slice(0, 100),
        rolledBack: true,
        performedBy: req.auth?.userId
      });

      return res.status(500).json({ message: "Import failed and all changes were rolled back" });
    }

    const log = await ImportLogModel.create({
      entity: entity.key,
      fileName: parsed.data.fileName,
      totalRows: rows.length,
      createdCount: docs.length,
      failedCount: errors.length,
      rowErrors: errors.slice(0, 100),
      rolledBack: false,
      performedBy: req.auth?.userId
    });

    // Imported teachers need a login to be usable, so provision one per new teacher.
    const provisionedLogins = entity.key === "teachers" ? await provisionTeacherLogins(assignedIds) : [];

    setAuditMeta(res, {
      action: "DATA_IMPORT",
      resource: "data-transfer",
      metadata: {
        entity: entity.key,
        importLogId: log.id,
        totalRows: rows.length,
        created: docs.length,
        failed: errors.length
      }
    });

    return res.status(201).json({
      preview: false,
      entity: entity.key,
      importLogId: log.id,
      totalRows: rows.length,
      createdCount: docs.length,
      failedCount: errors.length,
      errors: errors.slice(0, 100),
      provisionedLogins
    });
  })
);

dataTransferRouter.get(
  "/logs",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const rawPage = typeof query.page === "string" ? Number.parseInt(query.page, 10) : Number.NaN;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const pageSize = 10;

    const [items, total] = await Promise.all([
      ImportLogModel.find({}).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      ImportLogModel.countDocuments({})
    ]);

    return res.status(200).json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  })
);
