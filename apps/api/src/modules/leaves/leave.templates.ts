import { env } from "../../config/env.js";
import { formatDateKey } from "./leave-calendar.js";

const SCHOOL_NAME_HI = "जे. आर. प्रिपरेटरी स्कूल";

type RequestMessageContext = {
  teacherName: string;
  className: string;
  fromDate: string;
  toDate: string;
  reason: string;
  workingDays: number;
  portalUrl: string;
};

type DecisionMessageContext = {
  teacherName: string;
  status: "approved" | "partially_approved" | "rejected";
  fromDate: string;
  toDate: string;
  approvedFromDate?: string;
  approvedToDate?: string;
  approvedDays: number;
  note?: string;
  portalUrl: string;
};

function bilingual(english: string[], hindi: string[]) {
  return [...english, "", "--------------------", "", ...hindi].join("\n");
}

export function buildAdminLeaveRequestMessage(context: RequestMessageContext) {
  const classLabel = context.className ? ` (${context.className})` : "";
  return bilingual(
    [
      `Leave application from ${context.teacherName}${classLabel}`,
      `Dates: ${formatDateKey(context.fromDate)} to ${formatDateKey(context.toDate)}`,
      `School working days: ${context.workingDays}`,
      `Reason: ${context.reason}`,
      `Review: ${context.portalUrl}`
    ],
    [
      `${context.teacherName}${classLabel} का अवकाश आवेदन`,
      `तिथियां: ${formatDateKey(context.fromDate)} से ${formatDateKey(context.toDate)}`,
      `विद्यालय कार्य दिवस: ${context.workingDays}`,
      `कारण: ${context.reason}`,
      `समीक्षा करें: ${context.portalUrl}`
    ]
  );
}

export function buildTeacherLeaveDecisionMessage(context: DecisionMessageContext) {
  const statusEn = {
    approved: "approved",
    partially_approved: "partially approved",
    rejected: "rejected"
  }[context.status];
  const statusHi = {
    approved: "स्वीकृत किया गया है",
    partially_approved: "आंशिक रूप से स्वीकृत किया गया है",
    rejected: "अस्वीकृत किया गया है"
  }[context.status];
  const approvedRangeEn = context.approvedFromDate && context.approvedToDate
    ? `Approved dates: ${formatDateKey(context.approvedFromDate)} to ${formatDateKey(context.approvedToDate)} (${context.approvedDays} working days)`
    : undefined;
  const approvedRangeHi = context.approvedFromDate && context.approvedToDate
    ? `स्वीकृत तिथियां: ${formatDateKey(context.approvedFromDate)} से ${formatDateKey(context.approvedToDate)} (${context.approvedDays} कार्य दिवस)`
    : undefined;

  return bilingual(
    [
      `Leave update from ${env.SCHOOL_NAME}`,
      `Dear ${context.teacherName},`,
      `Your leave application for ${formatDateKey(context.fromDate)} to ${formatDateKey(context.toDate)} has been ${statusEn}.`,
      ...(approvedRangeEn ? [approvedRangeEn] : []),
      ...(context.note ? [`Admin note: ${context.note}`] : []),
      `View application: ${context.portalUrl}`
    ],
    [
      `${SCHOOL_NAME_HI} से अवकाश सूचना`,
      `प्रिय ${context.teacherName},`,
      `${formatDateKey(context.fromDate)} से ${formatDateKey(context.toDate)} तक आपका अवकाश आवेदन ${statusHi}।`,
      ...(approvedRangeHi ? [approvedRangeHi] : []),
      ...(context.note ? [`व्यवस्थापक टिप्पणी: ${context.note}`] : []),
      `आवेदन देखें: ${context.portalUrl}`
    ]
  );
}