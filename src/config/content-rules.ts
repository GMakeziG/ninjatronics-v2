// Content rules shared by the site's content schema (src/content.config.ts)
// and the Obsidian importer (scripts/obsidian/), so the two can't drift.
// No imports: this file is also loaded directly by Node.

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 160;

/** Lowercase words joined by single hyphens: `error-budgets`, `linux`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TAG_PATTERN = SLUG_PATTERN;

/** Site-relative path for legacy redirects: starts with "/", no query/hash. */
export const PATH_PATTERN = /^\/[^\s?#]*$/;

/** YYYY-MM-DD calendar date. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Article slugs that would collide with routes under /blog/. */
export const RESERVED_SLUGS = ["category", "tags"] as const;
