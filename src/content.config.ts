// Blog content collection. One folder per article:
//
//   src/content/blog/<slug>/index.md   (or index.mdx)
//   src/content/blog/<slug>/cover.png  (optional, plus any inline images)
//
// The folder name is the URL slug: /blog/<slug>. Every field below is
// validated at build time; an invalid article stops the build (fail closed).
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { CATEGORY_SLUGS } from "./config/categories";

const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_PATTERN = /^\/[^\s?#]*$/;

// Every entry, drafts included, is loaded and schema-validated, so a broken
// draft still fails the build. Drafts are kept out of production output by
// src/lib/posts.ts (pages, listings, RSS, redirects) and by the
// prune-unreferenced-assets integration (their images). Don't remove drafts
// from the store here: the store is cached on disk and shared with
// `astro dev`, so doing that breaks draft previews after any build.
const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "*/index.{md,mdx}" }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().trim().min(1).max(120),
        description: z
          .string()
          .trim()
          .min(1)
          .max(160, "description must be 160 characters or fewer (used for search and social previews)"),
        pubDate: z.coerce.date(),
        updatedDate: z.coerce.date().optional(),
        category: z.enum(CATEGORY_SLUGS),
        tags: z
          .array(z.string().regex(TAG_PATTERN, "tags must be lowercase slugs, e.g. 'kubernetes' or 'error-budgets'"))
          .default([])
          .refine((tags) => new Set(tags).size === tags.length, "tags must not contain duplicates"),
        draft: z.boolean().default(false),
        cover: image().optional(),
        coverAlt: z.string().trim().min(1).optional(),
        /** Force the table of contents on or off. Omit for automatic (3+ sections). */
        toc: z.boolean().optional(),
        /** Old URLs (e.g. WordPress permalinks) that should 301 to this article. */
        legacyUrls: z
          .array(z.string().regex(PATH_PATTERN, "legacyUrls must be site-relative paths starting with '/'"))
          .default([]),
      })
      .strict()
      .superRefine((data, ctx) => {
        if (data.cover && !data.coverAlt) {
          ctx.addIssue({ code: "custom", path: ["coverAlt"], message: "coverAlt is required when cover is set" });
        }
        if (data.updatedDate && data.updatedDate < data.pubDate) {
          ctx.addIssue({ code: "custom", path: ["updatedDate"], message: "updatedDate cannot be earlier than pubDate" });
        }
      }),
});

export const collections = { blog };
