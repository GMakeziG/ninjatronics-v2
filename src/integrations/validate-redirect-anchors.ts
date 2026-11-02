// Fails the build when a redirect in dist/_redirects targets a #fragment
// that doesn't exist on the destination page.
//
// src/pages/[redirects].ts already checks that every target *page* exists,
// but it runs before pages are rendered, so it can't see their element ids.
// This runs after the build, against the generated HTML.
import type { AstroIntegration } from "astro";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Path → built file, matching `build.format: "file"` (/projects → projects.html). */
function htmlFileFor(root: string, path: string): string {
  return path === "/" ? join(root, "index.html") : join(root, `${path.replace(/^\/|\/$/g, "")}.html`);
}

export default function validateRedirectAnchors(): AstroIntegration {
  return {
    name: "ninjatronics:validate-redirect-anchors",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const redirects = await readFile(join(root, "_redirects"), "utf8").catch(() => "");
        const targets = new Set(
          redirects
            .split("\n")
            .filter((line) => line && !line.startsWith("#"))
            .map((line) => line.split(/\s+/)[1])
            .filter((to) => to?.includes("#")),
        );

        const missing: string[] = [];
        for (const target of targets) {
          const [path, fragment] = target.split("#");
          const html = await readFile(htmlFileFor(root, path), "utf8").catch(() => "");
          if (!new RegExp(`\\sid="${fragment}"`).test(html)) missing.push(target);
        }
        if (missing.length) {
          throw new Error(`Redirect targets point at missing anchors:\n  - ${missing.join("\n  - ")}`);
        }
        logger.info(`Verified ${targets.size} redirect anchor(s).`);
      },
    },
  };
}
