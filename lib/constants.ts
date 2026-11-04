export const TOOL_CATEGORIES = [
  "power tools",
  "hand tools",
  "garden",
  "kitchen",
  "camping",
  "automotive",
  "cleaning",
  "other",
] as const;

export const TOOL_CONDITIONS = [
  { value: "like-new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
] as const;

export function formatCategory(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
