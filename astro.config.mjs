// @ts-check
import { defineConfig } from "astro/config";

// Static output only. `site` is the canonical origin used for absolute URLs
// (canonical links, Open Graph, and later the sitemap and RSS feed). No
// integrations yet: MDX, sitemap, and RSS arrive with the blog engine in
// Milestone 2.
export default defineConfig({
  site: "https://ninjatronics.io",
  output: "static",
  trailingSlash: "ignore",
});
