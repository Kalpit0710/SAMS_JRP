import mongoose from "mongoose";
import { SubstituteAssignmentModel } from "../models/substitute-assignment.model.js";
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

/** Classes a substitute may cover on a specific date, granted by an approved leave. */
export async function resolveSubstituteClassIds(
  userId: string,
  dateKey: string
): Promise<mongoose.Types.ObjectId[]> {
  const assignments = await SubstituteAssignmentModel.find({
    substituteUserId: new mongoose.Types.ObjectId(userId),
    status: "approved",
    dates: dateKey
  }).select("classId").lean();

  return assignments.map((assignment) => assignment.classId);
}

/** Own class plus any class this user is covering on the given date. */
export async function resolveAccessibleClassIds(
  userId: string,
  dateKey: string
): Promise<mongoose.Types.ObjectId[]> {
  const [ownClassId, substituteClassIds] = await Promise.all([
    resolveTeacherClassId(userId),
    resolveSubstituteClassIds(userId, dateKey)
  ]);

  const unique = new Map<string, mongoose.Types.ObjectId>();
  if (ownClassId) unique.set(String(ownClassId), ownClassId);
  for (const classId of substituteClassIds) unique.set(String(classId), classId);
  return [...unique.values()];
}

/** Matches nothing - used to give an unassigned teacher an empty result set instead of everything. */
export const MATCH_NOTHING = new mongoose.Types.ObjectId("000000000000000000000000");
