import { describe, expect, it } from "vitest";
import { buildDayCalendar, resolveDay } from "../../modules/teacher-attendance/attendance-day.js";

const calendar = buildDayCalendar({
  nonWorkingWeekdays: [0],
  holidays: [{ date: "2026-08-15", name: "Independence Day" }]
});

// 2026-08-12 is a Wednesday, 2026-08-16 is a Sunday.
const base = {
  today: "2026-08-12",
  nowMinutes: 9 * 60,
  finalizeMinutes: 17 * 60,
  calendar
};

describe("resolveDay", () => {
  it("treats configured weekly offs and holidays as non-working days", () => {
    const sunday = resolveDay({ ...base, date: "2026-08-16" });
    const holiday = resolveDay({ ...base, date: "2026-08-15" });

    expect(sunday.status).toBe("non_working");
    expect(sunday.effectiveStatus).toBeNull();
    expect(holiday.status).toBe("non_working");
    expect(holiday.holidayName).toBe("Independence Day");
    expect(holiday.correctionAvailable).toBe(false);
  });

  it("keeps the day pending until the closing time, then marks it absent", () => {
    const duringDay = resolveDay({ ...base, date: "2026-08-12" });
    const afterClosing = resolveDay({ ...base, date: "2026-08-12", nowMinutes: 17 * 60 + 1 });

    expect(duringDay.status).toBe("pending");
    expect(duringDay.effectiveStatus).toBeNull();
    expect(duringDay.correctionAvailable).toBe(false);
    expect(afterClosing.status).toBe("absent");
    expect(afterClosing.effectiveStatus).toBe("absent");
    expect(afterClosing.correctionAvailable).toBe(true);
  });

  it("marks an unmarked past working day absent and keeps corrections open forever", () => {
    const longAgo = resolveDay({ ...base, date: "2020-01-15" });

    expect(longAgo.status).toBe("absent");
    expect(longAgo.isFinalized).toBe(true);
    expect(longAgo.correctionAvailable).toBe(true);
  });

  it("never marks a future working day absent", () => {
    const future = resolveDay({ ...base, date: "2026-08-20" });

    expect(future.status).toBe("not_due");
    expect(future.effectiveStatus).toBeNull();
  });

  it("shows approved leave instead of absence", () => {
    const onLeave = resolveDay({ ...base, date: "2026-08-11", onApprovedLeave: true });

    expect(onLeave.status).toBe("on_leave");
    expect(onLeave.effectiveStatus).toBe("on_leave");
  });

  it("reports a conflict when attendance exists on an approved leave day", () => {
    const conflict = resolveDay({
      ...base,
      date: "2026-08-11",
      onApprovedLeave: true,
      record: { status: "on_time" }
    });

    expect(conflict.status).toBe("conflict");
    expect(conflict.hasConflict).toBe(true);
  });

  it("applies the manager decision once a conflict is resolved", () => {
    const keptAttendance = resolveDay({
      ...base,
      date: "2026-08-11",
      onApprovedLeave: true,
      record: { status: "on_time", conflictResolution: "keep_attendance" }
    });
    const appliedLeave = resolveDay({
      ...base,
      date: "2026-08-11",
      onApprovedLeave: true,
      record: { status: "on_time", conflictResolution: "apply_leave" }
    });

    expect(keptAttendance.status).toBe("present");
    expect(keptAttendance.hasConflict).toBe(false);
    expect(appliedLeave.status).toBe("on_leave");
  });

  it("surfaces a pending correction on an absent day", () => {
    const requested = resolveDay({ ...base, date: "2026-08-11", hasPendingCorrection: true });

    expect(requested.status).toBe("correction_requested");
    expect(requested.effectiveStatus).toBe("absent");
    expect(requested.correctionAvailable).toBe(false);
  });

  it("counts a corrected day by its approved final status", () => {
    const corrected = resolveDay({
      ...base,
      date: "2026-08-11",
      record: { status: "corrected", correctedToStatus: "late" }
    });

    expect(corrected.status).toBe("late");
    expect(corrected.effectiveStatus).toBe("late");
    expect(corrected.wasCorrected).toBe(true);
  });

  it("flags an absence overturned by an approved request as corrected", () => {
    const overturned = resolveDay({
      ...base,
      date: "2026-08-11",
      record: { status: "on_time", originalStatus: "absent" }
    });

    expect(overturned.status).toBe("present");
    expect(overturned.effectiveStatus).toBe("present");
    expect(overturned.wasCorrected).toBe(true);
  });
});
