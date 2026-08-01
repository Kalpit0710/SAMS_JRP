import mongoose from "mongoose";
import { TeacherModel } from "../models/teacher.model.js";

/**
 * The class a teacher owns, or null when they have none assigned.
 * Scoping is resolved from the signed-in user rather than the request so a
 * teacher cannot widen their own view by passing a different classId.
 */
export async function resolveTeacherClassId(userId: string): Promise<mongoose.Types.ObjectId | null> {
  const teacher = await TeacherModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true
  }).select("classId");

  return teacher?.classId ?? null;
}

/** Matches nothing - used to give an unassigned teacher an empty result set instead of everything. */
export const MATCH_NOTHING = new mongoose.Types.ObjectId("000000000000000000000000");
