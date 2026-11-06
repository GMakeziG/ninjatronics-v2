// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { ninjatronicsTheme, codeBlockTransformer } from "./src/lib/shiki.ts";
import pruneUnreferencedAssets from "./src/integrations/prune-unreferenced-assets.ts";
import validateRedirectAnchors from "./src/integrations/validate-redirect-anchors.ts";

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
  build: {
    format: "file",
    // Strict Content-Security-Policy (public/_headers): ship CSS as files
    // instead of inline <style> blocks, so style-src needs no 'unsafe-inline'.
    inlineStylesheets: "never",
  },
  vite: {
    build: {
      // Same reason for scripts: never inline small scripts, so script-src
      // can stay 'self' only. (This also stops inlining small assets as data:
      // URIs; every asset is a cacheable file instead.)
      assetsInlineLimit: 0,
    },
  },
  markdown: {
    shikiConfig: {
      theme: ninjatronicsTheme,
      transformers: [codeBlockTransformer],
      wrap: false,
    },
  },
  integrations: [
    mdx(),
    // Drafts are excluded upstream: production builds don't generate draft
    // pages at all.
    sitemap(),
    // Keeps draft images out of dist/ (see the integration for details).
    pruneUnreferencedAssets(),
    // Fails the build if a redirect points at a #fragment the page lacks.
    validateRedirectAnchors(),
  ],
});
