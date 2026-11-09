// Now page content (Milestone 3C, approved 2026-11-02).
//
// A snapshot of current focus, written and approved by the author. To update
// the page: edit the items, set `updated` to the date the new content was
// approved (not the commit date), and commit. Only the current snapshot is
// kept; Git history holds earlier versions.
//
// Items stay short and link out to Projects and articles instead of
// repeating their descriptions. Self-hosted services stay generic.
//
// Validated when the module loads, so a malformed entry fails the build.
import { z } from "astro/zod";
import { PROJECTS } from "./projects";

/** Days after which the build reminds (never fails) that the page is stale. */
export const STALE_AFTER_DAYS = 90;

const projectIds = new Set(PROJECTS.featured.flatMap((p) => [p.id, ...p.extraAnchors]));

const linkSchema = z.discriminatedUnion("kind", [
  // A project anchor on /projects (checked against src/data/projects.ts).
  z.object({
    kind: z.literal("project"),
    id: z.string().refine((id) => projectIds.has(id), { message: "Not a project anchor in src/data/projects.ts" }),
  }),
  // A published article (checked by the page, which knows what's published).
  z.object({ kind: z.literal("article"), slug: z.string().regex(/^[a-z0-9-]+$/) }),
]);

const itemSchema = z.object({
  title: z.string().min(1),
  note: z.string().min(1),
  links: z.array(linkSchema).default([]),
});

const section = z.array(itemSchema).min(1).max(3);

const nowSchema = z.object({
  updated: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date")
    .refine((value) => value <= new Date().toISOString().slice(0, 10), "Last updated can't be in the future"),
  intro: z.string().min(1),
  building: section,
  learning: section,
  experimenting: section,
});

export type NowItem = z.infer<typeof itemSchema>;

export const NOW = nowSchema.parse({
  updated: "2026-11-09",
  intro:
    "A snapshot of what I'm building, learning, and experimenting with right now. I update this page as my priorities change.",

  building: [
    {
      title: "Kubernetes GitOps homelab",
      note: "Maintaining and improving my self-hosted Kubernetes environment using Flux, infrastructure automation, and GitOps.",
      links: [{ kind: "project", id: "lab" }],
    },
  ],

  learning: [
    {
      title: "DevOps and platform engineering",
      note: "Developing practical skills in building reliable, repeatable infrastructure and improving developer workflows.",
    },
    {
      title: "Linux and infrastructure automation",
      note: "Deepening my Linux administration skills and automating infrastructure management with code.",
    },
  ],

  experimenting: [
    {
      title: "AI tooling",
      note: "Exploring how specialized AI agents can support software development, infrastructure management, and automation.",
      links: [{ kind: "project", id: "ninjatronics-ai" }],
    },
    {
      title: "Self-hosted services",
      note: "Testing and operating private applications on infrastructure I manage.",
    },
    {
      title: "Observability",
      note: "Improving visibility into infrastructure health using Prometheus, Grafana, and related monitoring tools.",
      links: [{ kind: "project", id: "lab" }],
    },
  ],
});

/** Whole days since `updated` (UTC calendar dates). */
export function daysSinceUpdate(today = new Date()): number {
  const updated = Date.parse(`${NOW.updated}T00:00:00Z`);
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.floor((now - updated) / 86_400_000);
}
