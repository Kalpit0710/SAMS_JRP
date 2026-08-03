const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_LEAVE_RANGE_DAYS = 366;

export type LeaveHoliday = {
  date: string;
  name: string;
};

export type LeaveCalendarSettings = {
  nonWorkingWeekdays: number[];
  holidays: LeaveHoliday[];
};

export function parseDateKey(dateKey: string): Date | null {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

export function toDateKey(value: Date): string {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function formatDateKey(dateKey: string): string {
  const value = parseDateKey(dateKey);
  if (!value) {
    return dateKey;
  }

  return [
    String(value.getUTCDate()).padStart(2, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    value.getUTCFullYear()
  ].join("/");
}

export function todayDateKey(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

export function enumerateDateKeys(fromDate: string, toDate: string): string[] {
  const from = parseDateKey(fromDate);
  const to = parseDateKey(toDate);
  if (!from || !to || from > to) {
    throw new Error("Invalid leave date range");
  }

  const dates: string[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    if (dates.length >= MAX_LEAVE_RANGE_DAYS) {
      throw new Error(`Leave date range cannot exceed ${MAX_LEAVE_RANGE_DAYS} days`);
    }
    dates.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function getWorkingDateKeys(
  fromDate: string,
  toDate: string,
  settings: LeaveCalendarSettings
): string[] {
  const nonWorkingWeekdays = new Set(settings.nonWorkingWeekdays);
  const holidays = new Set(settings.holidays.map((holiday) => holiday.date));

  return enumerateDateKeys(fromDate, toDate).filter((dateKey) => {
    const date = parseDateKey(dateKey);
    return date !== null && !nonWorkingWeekdays.has(date.getUTCDay()) && !holidays.has(dateKey);
  });
}