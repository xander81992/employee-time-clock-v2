import type { Timestamp } from "firebase/firestore";

export const REPORT_TIME_ZONE = "America/Toronto";
export const WORK_LUNCH_BREAK_MINUTES = 30;

export function timestampToDate(value: Timestamp | null | undefined): Date | null {
  return value?.toDate ? value.toDate() : null;
}

export function formatDateTime(value: Timestamp | null | undefined): string {
  const date = timestampToDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function formatTime(value: Timestamp | null | undefined): string {
  const date = timestampToDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

export function durationMinutes(
  timeIn: Timestamp | null | undefined,
  timeOut: Timestamp | null | undefined,
  now = new Date()
): number {
  const start = timestampToDate(timeIn);
  if (!start) return 0;

  const end = timestampToDate(timeOut) ?? now;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export function netWorkMinutes(grossMinutes: number): number {
  const safeGrossMinutes = Math.max(0, Math.round(grossMinutes));
  return Math.max(0, safeGrossMinutes - WORK_LUNCH_BREAK_MINUTES);
}

export function workDurationMinutes(
  timeIn: Timestamp | null | undefined,
  timeOut: Timestamp | null | undefined,
  now = new Date()
): number {
  return netWorkMinutes(durationMinutes(timeIn, timeOut, now));
}

export function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remaining = safeMinutes % 60;
  return `${hours}h ${remaining.toString().padStart(2, "0")}m`;
}

export function todayInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthStartInputValue(date = new Date()): string {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  return todayInputValue(first);
}

export function addDaysInputValue(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return todayInputValue(result);
}

export function timestampToDateTimeLocalValue(
  value: Timestamp | null | undefined
): string {
  const date = timestampToDate(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function dateKeyFromTimestamp(
  value: Timestamp | null | undefined
): string {
  const date = timestampToDate(value);
  if (!date) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export function dateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59.999`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Choose a valid report date range.");
  }

  if (start > end) {
    throw new Error("The start date cannot be after the end date.");
  }

  return { start, end };
}

export function weekRangeSunday(dateInput: string) {
  const selected = new Date(`${dateInput}T12:00:00`);
  if (Number.isNaN(selected.getTime())) {
    throw new Error("Choose a valid week date.");
  }

  const start = new Date(selected);
  start.setDate(selected.getDate() - selected.getDay());
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      dateKey: todayInputValue(date),
      weekday: new Intl.DateTimeFormat("en-CA", {
        timeZone: REPORT_TIME_ZONE,
        weekday: "long"
      }).format(date)
    };
  });

  return {
    start,
    end,
    startDateKey: todayInputValue(start),
    endDateKey: todayInputValue(end),
    days
  };
}
