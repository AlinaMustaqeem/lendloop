import { ConvexError } from "convex/values";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateRange(startDate: string, endDate: string) {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    throw new ConvexError("Dates must use YYYY-MM-DD format");
  }
  if (Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) {
    throw new ConvexError("Invalid start date");
  }
  if (Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
    throw new ConvexError("Invalid end date");
  }
  if (startDate > endDate) {
    throw new ConvexError("End date must be on or after start date");
  }
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
) {
  return startA <= endB && startB <= endA;
}

export function todayUtc(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
