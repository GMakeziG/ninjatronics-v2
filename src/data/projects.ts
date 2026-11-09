// Projects page content (Milestone 3B, approved 2026-11-02).
//
// Every summary and tech chip was verified against the repository itself
// (README, file tree, dependency manifests). Don't add outcomes, metrics,
// versions, users, or deployment claims the author hasn't confirmed.
//
// Homelab rule: describe the platform only. Never add application names,
// hostnames, ingress or tunnel details, secrets infrastructure, or anything
// about how the lab is reached or secured.
//
// Validated when the module loads, so a malformed entry fails the build.
import { z } from "astro/zod";

const githubRepo = z.url({ protocol: /^https$/ }).regex(/^https:\/\/github\.com\/GMakeziG\/[A-Za-z0-9._-]+$/, "Must be a GMakeziG GitHub repository URL");
const anchor = z.string().regex(/^[a-z0-9-]+$/, "Lowercase, hyphenated anchor id");

/**
 * What the card shows today: one label. The optional fields keep
 * development activity and software maturity separable later without
 * changing any card; nothing renders them yet. Only set them when the
 * approved label states them (e.g. "Alpha" is a maturity).
 */
export const STATUS_LABELS = ["Live", "Active", "In development", "Alpha", "Paused", "Maintained"] as const;
const statusSchema = z.object({
  label: z.enum(STATUS_LABELS),
  activity: z.enum(["active", "paused", "maintained"]).optional(),
  maturity: z.enum(["alpha", "beta", "stable"]).optional(),
});

const featuredSchema = z.object({
  /** Primary anchor id; for repositories, the repository name. */
  id: anchor,
  /** Extra anchors on the same card (e.g. a second repository). */
  extraAnchors: z.array(anchor).default([]),
  name: z.string().min(1),
  category: z.string().min(1),
  status: statusSchema,
  summary: z.string().min(1),
  tech: z.array(z.string().min(1)).min(1),
  repositories: z.array(z.object({ label: z.string().min(1), url: githubRepo })),
  /** Slug of a published article about the project (checked at build). */
  relatedArticle: z.string().optional(),
  /** Spans the full grid width (the flagship project). */
  wide: z.boolean().default(false),
});

const learningSchema = z.object({
  id: anchor,
  name: z.string().min(1),
  summary: z.string().min(1),
  url: githubRepo,
});

const projectsSchema = z.object({
  intro: z.string().min(1),
  learningIntro: z.string().min(1),
  featured: z.array(featuredSchema).min(1),
  learning: z.array(learningSchema),
});

export type FeaturedProject = z.infer<typeof featuredSchema>;
export type ProjectStatus = z.infer<typeof statusSchema>;

const repo = (name: string) => ({ label: name, url: `https://github.com/GMakeziG/${name}` });

export const PROJECTS = projectsSchema.parse({
  intro: "Things I build to learn, automate, and run my own infrastructure.",
  learningIntro: "Smaller repositories where I practice languages and tools.",

  featured: [
    {
      id: "lab",
      name: "lab",
      category: "Platform · GitOps",
      status: { label: "Active", activity: "active" },
      summary:
        "A Kubernetes homelab managed entirely through Git. Flux reconciles a k3s cluster from this repository, covering core infrastructure, applications, secrets management, certificates, and observability. It's deliberately built to be broken and rebuilt as a hands-on DevOps learning platform.",
      tech: ["Kubernetes (k3s)", "Flux", "Kustomize", "Helm", "Traefik", "MetalLB", "cert-manager", "External Secrets", "Renovate", "Prometheus", "Grafana"],
      repositories: [repo("lab")],
      wide: true,
    },
    {
      id: "ninjatronics-v2",
      name: "Ninjatronics v2",
      category: "Publishing · Web",
      status: { label: "Live", activity: "active" },
      summary:
        "This website, live at ninjatronics.io since November 2026: a static Astro site served by Cloudflare Workers, with a publishing pipeline from a private Obsidian vault. Articles are validated before import and reviewed before publication. GitHub Actions deploys each release to an access-protected staging environment first, then promotes the same verified commit to production after approval.",
      tech: ["Astro", "TypeScript", "Markdown/MDX", "Obsidian", "Syncthing", "Cloudflare Workers", "GitHub Actions"],
      // No public repository yet: add it here once published.
      repositories: [],
      relatedArticle: "obsidian-syncthing-headless-linux",
    },
    {
      id: "gitops-scaffold",
      name: "gitops-scaffold",
      category: "GitOps · Tooling",
      status: { label: "Alpha", maturity: "alpha" },
      summary:
        "Analyzes a Docker Compose file, reports what it did and didn't understand, then generates Flux and Kustomize manifests for review. It flags uncertainty instead of guessing, and never writes real secrets into generated files.",
      tech: ["Python", "Jinja", "Docker Compose", "Flux", "Kustomize"],
      repositories: [repo("gitops-scaffold")],
    },
    {
      id: "signalnode",
      name: "signalnode",
      category: "Monitoring · Rust",
      status: { label: "Paused", activity: "paused" },
      summary:
        "A monitoring platform for website uptime, SSL certificates, and API endpoints. The repository contains the Rust API and monitoring engine; a web dashboard and WordPress integration are planned.",
      tech: ["Rust", "Axum", "SQLx", "PostgreSQL", "Docker Compose"],
      repositories: [repo("signalnode")],
    },
    {
      id: "ninja-voice",
      name: "ninja-voice",
      category: "Self-hosted · AI",
      status: { label: "In development" },
      summary:
        "A private, self-hosted text-to-speech app: paste long-form text, choose a voice, and keep the generated audio in a listen-later library. Audio is generated locally with the Kokoro model instead of a cloud service.",
      tech: ["Next.js", "TypeScript", "Python", "FastAPI", "SQLite", "Kokoro TTS", "Docker Compose"],
      repositories: [repo("ninja-voice")],
    },
    {
      id: "ninjatronics-ai",
      name: "Ninjatronics AI",
      category: "AI · Automation",
      status: { label: "Active", activity: "active" },
      summary:
        "An AI agent orchestration platform that organizes specialized agents into an engineering team with clear ownership, reproducible workflows, and version-controlled operating standards.",
      tech: ["Herdr", "Hermes", "Claude Code", "Codex", "Shell", "Python"],
      repositories: [repo("ninjatronics-ai")],
    },
    {
      id: "devops-devpod",
      extraAnchors: ["devpod-dotfiles"],
      name: "Ninjatronics DevOps IDE",
      category: "Developer environment",
      status: { label: "Maintained", activity: "maintained" },
      summary:
        "A portable DevPod and devcontainer workstation for DevOps, Kubernetes, and infrastructure-as-code work, documented for Windows (WSL2) and headless Linux. Personal dotfiles configure the editor and shell inside it.",
      tech: ["DevPod", "Dev Containers", "Docker", "kubectl", "Helm", "Flux", "Terraform", "Ansible", "Neovim", "tmux"],
      repositories: [repo("devops-devpod"), repo("devpod-dotfiles")],
    },
  ],

  // python-practice is excluded while it's empty.
  learning: [
    { id: "go-practice", name: "go-practice", summary: "Go exercises and coding challenges, with a learning journal.", url: repo("go-practice").url },
    { id: "cpp-practice", name: "cpp-practice", summary: "Learning journal for C++ fundamentals, algorithms, and systems programming.", url: repo("cpp-practice").url },
    { id: "javascript-practice", name: "javascript-practice", summary: "Learning journal for JavaScript, web automation, and internal tools.", url: repo("javascript-practice").url },
    { id: "skills-introduction-to-git", name: "skills-introduction-to-git", summary: "GitHub Skills exercise: Introduction to Git.", url: repo("skills-introduction-to-git").url },
  ],
});

// Anchor ids must be unique on the page (they're redirect targets).
const ids = [...PROJECTS.featured.flatMap((p) => [p.id, ...p.extraAnchors]), ...PROJECTS.learning.map((l) => l.id)];
const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
if (duplicate) throw new Error(`src/data/projects.ts: duplicate anchor id "${duplicate}"`);
