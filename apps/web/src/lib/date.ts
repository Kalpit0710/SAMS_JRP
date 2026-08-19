const DISPLAY_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDateParts(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

export function displayDateToKey(value: string): string | null {
  const match = DISPLAY_DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  return isValidDateParts(year, month, day) ? `${yearText}-${monthText}-${dayText}` : null;
}

export function dateKeyToDisplay(value: string): string {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return value;
  const [, yearText, monthText, dayText] = match;
  return `${dayText}/${monthText}/${yearText}`;
}

export function todayDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function currentMonthRange(date = new Date()) {
  const fromDate = new Date(date.getFullYear(), date.getMonth(), 1);
  const toDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { fromDate: dateKeyToDisplay(todayDateKey(fromDate)), toDate: dateKeyToDisplay(todayDateKey(toDate)) };
}