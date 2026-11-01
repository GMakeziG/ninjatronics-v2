// Removes image files from dist/_astro/ that no built file references.
//
// Why: Astro processes images for every content entry, drafts included, so a
// draft's cover and inline images would be emitted to the public CDN even
// though nothing links to them. Draft pages, listings, RSS entries, and
// metadata are never built, so their images end up unreferenced and are
// removed here. Only image files are ever considered; fonts, CSS, and JS are
// never touched.
import type { AstroIntegration } from "astro";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const TEXT = /\.(html|xml|css|js|json|txt|webmanifest)$|(^|\/)_redirects$|(^|\/)_headers$/i;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])),
  );
  return files.flat();
}

export default function pruneUnreferencedAssets(): AstroIntegration {
  return {
    name: "ninjatronics:prune-unreferenced-assets",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const assetsDir = join(root, "_astro");
        const files = await walk(root);
        const candidates = files.filter((f) => f.startsWith(assetsDir) && IMAGE.test(f));
        if (candidates.length === 0) return;

        const texts = await Promise.all(files.filter((f) => TEXT.test(f)).map((f) => readFile(f, "utf8")));
        const corpus = texts.join("\n");

        const removed: string[] = [];
        for (const file of candidates) {
          const name = file.slice(assetsDir.length + 1);
          if (!corpus.includes(name)) {
            await unlink(file);
            removed.push(relative(root, file));
          }
        }
        if (removed.length) logger.info(`Removed ${removed.length} unreferenced image(s): ${removed.join(", ")}`);
      },
    },
  };
}
