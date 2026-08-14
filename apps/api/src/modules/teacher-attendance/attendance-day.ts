import { parseDateKey } from "../leaves/leave-calendar.js";

/**
 * Single source of truth for "what happened on this day for this teacher".
 * Attendance screens, leave screens, reports and dashboards all resolve status
 * through here so they can never disagree with each other.
 */
export const TEACHER_DAY_STATUSES = [
  "non_working",
  "not_due",
  "pending",
  "present",
  "late",
  "on_leave",
  "absent",
  "correction_requested",
  "conflict"
] as const;

export type TeacherDayStatus = (typeof TEACHER_DAY_STATUSES)[number];

/** Statuses that carry weight in attendance totals and payroll style reports. */
export type EffectiveDayStatus = "present" | "late" | "on_leave" | "absent";

export type RecordStatus = "on_time" | "late" | "on_leave" | "corrected";
export type CorrectedToStatus = "on_time" | "late" | "on_leave";
export type ConflictResolution = "keep_attendance" | "apply_leave";

export type DayCalendar = {
  nonWorkingWeekdays: Set<number>;
  holidays: Map<string, string>;
};

export type DayRecordInput = {
  status: RecordStatus;
  correctedToStatus?: CorrectedToStatus | null;
  conflictResolution?: ConflictResolution | null;
  originalStatus?: string | null;
};

export type ResolveDayInput = {
  date: string;
  today: string;
  nowMinutes: number;
  finalizeMinutes: number | null;
  calendar: DayCalendar;
  record?: DayRecordInput | null;
  onApprovedLeave?: boolean;
  hasPendingCorrection?: boolean;
};

export type ResolvedDay = {
  status: TeacherDayStatus;
  effectiveStatus: EffectiveDayStatus | null;
  isWorkingDay: boolean;
  isFinalized: boolean;
  wasCorrected: boolean;
  correctionPending: boolean;
  correctionAvailable: boolean;
  hasConflict: boolean;
  holidayName?: string;
};

export function buildDayCalendar(settings: {
  nonWorkingWeekdays: number[];
  holidays: Array<{ date: string; name: string }>;
}): DayCalendar {
  return {
    nonWorkingWeekdays: new Set(settings.nonWorkingWeekdays),
    holidays: new Map(settings.holidays.map((holiday) => [holiday.date, holiday.name]))
  };
}

export function describeNonWorking(date: string, calendar: DayCalendar): { nonWorking: boolean; holidayName?: string } {
  const holidayName = calendar.holidays.get(date);
  if (holidayName) return { nonWorking: true, holidayName };
  const parsed = parseDateKey(date);
  if (!parsed) return { nonWorking: false };
  return { nonWorking: calendar.nonWorkingWeekdays.has(parsed.getUTCDay()) };
}

function effectiveFromRecord(record: DayRecordInput): EffectiveDayStatus {
  const status = record.status === "corrected" ? record.correctedToStatus ?? "on_time" : record.status;
  if (status === "on_time") return "present";
  if (status === "late") return "late";
  return "on_leave";
}

/**
 * School policy: attendance stays open all day, and any working day that ends
 * without attendance becomes a real absence. Corrections never expire.
 */
export function resolveDay(input: ResolveDayInput): ResolvedDay {
  const { nonWorking, holidayName } = describeNonWorking(input.date, input.calendar);
  if (nonWorking) {
    return {
      status: "non_working",
      effectiveStatus: null,
      isWorkingDay: false,
      isFinalized: false,
      wasCorrected: false,
      correctionPending: false,
      correctionAvailable: false,
      hasConflict: false,
      holidayName
    };
  }

  const correctionPending = Boolean(input.hasPendingCorrection);
  const isPastDay = input.date < input.today;
  const isToday = input.date === input.today;
  const dayClosed = isPastDay
    || (isToday && input.finalizeMinutes !== null && input.nowMinutes >= input.finalizeMinutes);

  if (input.date > input.today) {
    return {
      status: "not_due",
      effectiveStatus: null,
      isWorkingDay: true,
      isFinalized: false,
      wasCorrected: false,
      correctionPending,
      correctionAvailable: false,
      hasConflict: false
    };
  }

  const base = {
    isWorkingDay: true,
    isFinalized: dayClosed,
    correctionPending
  };

  if (input.record) {
    // A preserved original status means the day was changed from what actually happened.
    const wasCorrected = input.record.status === "corrected" || Boolean(input.record.originalStatus);
    const resolution = input.record.conflictResolution ?? null;
    const recordEffective = effectiveFromRecord(input.record);
    const collides = Boolean(input.onApprovedLeave) && recordEffective !== "on_leave";

    if (collides && resolution === null) {
      return {
        ...base,
        status: "conflict",
        effectiveStatus: recordEffective,
        wasCorrected,
        correctionAvailable: false,
        hasConflict: true
      };
    }

    const effectiveStatus = resolution === "apply_leave" ? "on_leave" : recordEffective;
    return {
      ...base,
      status: effectiveStatus,
      effectiveStatus,
      wasCorrected,
      correctionAvailable: !correctionPending && effectiveStatus !== "on_leave",
      hasConflict: false
    };
  }

  if (input.onApprovedLeave) {
    return {
      ...base,
      status: "on_leave",
      effectiveStatus: "on_leave",
      wasCorrected: false,
      correctionAvailable: false,
      hasConflict: false
    };
  }

  if (!dayClosed) {
    return {
      ...base,
      status: "pending",
      effectiveStatus: null,
      wasCorrected: false,
      correctionAvailable: false,
      hasConflict: false
    };
  }

  return {
    ...base,
    status: correctionPending ? "correction_requested" : "absent",
    effectiveStatus: "absent",
    wasCorrected: false,
    correctionAvailable: !correctionPending,
    hasConflict: false
  };
}

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function schoolDateKey(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function schoolMinutes(timezone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

export function enumerateDays(from: string, to: string): string[] {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (!start || !end || start > end) return [];
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
