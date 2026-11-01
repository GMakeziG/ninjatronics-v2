# Publishing an article

Publishing never requires editing page code. Add a folder, write the file,
build.

## 1. Create the folder

```
src/content/blog/<slug>/index.md     # or index.mdx for callouts/components
src/content/blog/<slug>/cover.png    # optional, plus any inline images
```

The folder name becomes the URL: `/blog/<slug>`. Use lowercase words joined
by hyphens. For a migrated post, keep its original slug.

## 2. Frontmatter

```yaml
---
title: "Example article title"             # required, ≤120 chars
description: "One or two sentences."        # required, ≤160 chars (search + social previews)
pubDate: 2025-01-15                         # required; for migrated posts, the ORIGINAL date
updatedDate: 2025-02-01                     # optional; must not be before pubDate
category: platform-engineering              # required; see src/config/categories.ts
tags: [example-tag, another-tag]            # optional; lowercase-hyphenated
draft: true                                 # optional, default false
cover: ./cover.png                          # optional
coverAlt: "Describe the image."             # required when cover is set
toc: true                                   # optional; default = automatic (3+ sections)
legacyUrls: ["/2025/01/example-article/"]   # optional; old URLs that 301 here
---
```

Categories: `platform-engineering`, `linux`, `automation`, `security`,
`gitops`, `infrastructure-as-code`. To add one, edit
`src/config/categories.ts`. Tags are free-form.

Mistakes fail the build with a message naming the field: missing or overlong
fields, an unknown category, a malformed tag, a typo'd field name, a cover
without alt text, an `updatedDate` before `pubDate`, or a `legacyUrls` entry
that collides with a real page.

## 3. Write

- Headings: start at `##`. The page title is the only `#`. Three or more `##`
  sections turn on the table of contents automatically.
- Code: fenced blocks with a language (` ```bash `, ` ```yaml `, ` ```ts `).
  For shell sessions, prefix commands with `$ `. The copy button copies only
  the commands, without prompts or output.
- Images: `![Alt text that describes the image](./diagram.png)`, stored in the
  article folder. Astro optimizes them.
- Callouts (`.mdx` only, no import needed):

  ```mdx
  <Callout type="note">Context the reader may want.</Callout>
  <Callout type="tip" title="Optional title">A better approach.</Callout>
  <Callout type="warning">Something that can break things.</Callout>
  ```

## 4. Preview and publish

- `npm run dev` shows drafts with a DRAFT banner at http://localhost:4321.
- Set `draft: false` (or remove the line) to publish.
- `npm run check && npm run build` must pass.

Drafts never reach production: no page, listing, tag/category page, RSS
item, sitemap entry, redirect, or image file.

## Reference

`src/content/blog/style-guide/index.mdx` is a permanent draft fixture that
exercises every formatting feature. Never set it to `draft: false`.
