/** "Mar 8, 2025". Dates are calendar dates, so format in UTC to avoid off-by-one shifts. */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2025-03-08", for <time datetime>. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
