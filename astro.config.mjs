// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { ninjatronicsTheme, codeBlockTransformer } from "./src/lib/shiki.ts";
import pruneUnreferencedAssets from "./src/integrations/prune-unreferenced-assets.ts";

// Static output. `site` is the canonical origin for absolute URLs
// (canonical links, Open Graph, RSS, sitemap).
//
// URLs have no trailing slash: `build.format: "file"` emits blog/<slug>.html,
// which Cloudflare serves at /blog/<slug>. Canonical links, navigation, the
// sitemap, and RSS all use that same form.
export default defineConfig({
  site: "https://ninjatronics.io",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "file" },
  markdown: {
    shikiConfig: {
      theme: ninjatronicsTheme,
      transformers: [codeBlockTransformer],
      wrap: false,
    },
  },
  integrations: [
    mdx(),
    sitemap({
      // Internal review pages never go in the sitemap. Drafts are excluded
      // upstream: production builds don't generate draft pages at all.
      filter: (page) => !page.includes("/brand-preview"),
    }),
    // Keeps draft images out of dist/ (see the integration for details).
    pruneUnreferencedAssets(),
  ],
});
