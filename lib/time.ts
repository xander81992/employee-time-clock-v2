import type { Timestamp } from "firebase/firestore";

export const REPORT_TIME_ZONE = "America/Toronto";

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
