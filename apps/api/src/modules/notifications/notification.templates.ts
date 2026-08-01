import type { NotifiableStatus } from "../../models/notification.model.js";

const SCHOOL_NAME_HI = "जे. आर. प्रिपरेटरी स्कूल";

export type MessageContext = {
  schoolName: string;
  studentName: string;
  className: string;
  dateLabel: string;
  status: NotifiableStatus;
};

const STATUS_TEXT: Record<NotifiableStatus, { en: string; hi: string }> = {
  absent: { en: "was absent", hi: "अनुपस्थित थे" },
  late: { en: "came late to school", hi: "स्कूल देर से आए थे" },
  half_day: { en: "attended school for half a day", hi: "आधे दिन स्कूल में उपस्थित थे" }
};

function buildEnglish(context: MessageContext) {
  return [
    `Attendance update from ${context.schoolName}`,
    "",
    "Dear Parent,",
    `${context.studentName} (${context.className}) ${STATUS_TEXT[context.status].en} on ${context.dateLabel}.`,
    "",
    "If this information is not correct, please contact the school."
  ].join("\n");
}

function buildHindi(context: MessageContext) {
  return [
    `${SCHOOL_NAME_HI} से उपस्थिति सूचना`,
    "",
    "प्रिय अभिभावक,",
    `${context.studentName} (${context.className}) ${context.dateLabel} को ${STATUS_TEXT[context.status].hi}।`,
    "",
    "यदि यह जानकारी सही नहीं है, तो कृपया स्कूल से संपर्क करें।"
  ].join("\n");
}

export function buildBilingualMessage(english: string, hindi: string) {
  return [
    english,
    "",
    "--------------------",
    "",
    hindi
  ].join("\n");
}

export const NOTIFICATION_STATUS_LABELS = {
  en: buildEnglish,
  hi: buildHindi
};
