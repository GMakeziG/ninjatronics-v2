// The single source of truth for blog categories. Articles must use one of
// these slugs (enforced by the content schema). Adding a category is a
// one-line change here; no page or component edits are needed.

export const CATEGORIES = [
  { slug: "platform-engineering", label: "Platform Engineering" },
  { slug: "linux", label: "Linux" },
  { slug: "automation", label: "Automation" },
  { slug: "security", label: "Security" },
  { slug: "gitops", label: "GitOps" },
  { slug: "infrastructure-as-code", label: "Infrastructure as Code", shortLabel: "IaC" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]];

export function getCategory(slug: CategorySlug) {
  const category = CATEGORIES.find((c) => c.slug === slug);
  if (!category) throw new Error(`Unknown category: ${slug}`);
  return category;
}
