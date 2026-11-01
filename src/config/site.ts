// Site-wide constants: identity, navigation, and copy taken from the
// approved design references. Anything not in the references is a
// clearly marked placeholder rather than invented content.

export const SITE = {
  name: "Ninjatronics",
  url: "https://ninjatronics.io",
  tagline: ["Engineering in the shadows.", "Building in the open."] as const,
  description:
    "Technical field notes on platform engineering, Linux, automation, GitOps, and security.",
  topics: ["Platform Engineering", "Linux", "Automation", "Security"] as const,
  github: "https://github.com/GMakeziG",
  language: "en-US",
} as const;

/** Article byline and structured-data author (approved for Milestone 2). */
export const AUTHOR = {
  name: "Gerso Robayo-Guillen",
  url: "https://github.com/GMakeziG",
} as const;

export interface NavItem {
  label: string;
  href: string;
}

/** Primary navigation, matching docs/design/ninjatronics-v2-reference.png. */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Blog", href: "/blog" },
  { label: "Projects", href: "/projects" },
  { label: "About", href: "/about" },
  { label: "Now", href: "/now" },
];

/** Footer navigation adds Contact, which isn't in the reference header. */
export const FOOTER_NAV: NavItem[] = [...PRIMARY_NAV, { label: "Contact", href: "/contact" }];

/** True when `href` is the current section (e.g. /blog/foo → Blog). */
export function isCurrentSection(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === href || path.startsWith(`${href}/`);
}
