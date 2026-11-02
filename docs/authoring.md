# Writing and publishing articles

Articles are written in Obsidian, in the `ninjatronics-v2` vault, and
published to the site by an explicit import, review, and commit. Editing or
syncing a note never publishes anything.

```
Obsidian vault  ──(npm run import)──▶  src/content/blog/  ──(git commit + push)──▶  website
 (any device)        you run it            reviewed in git        you approve each step
```

- **Obsidian** is where you write (Linux, Mac, phone). How the vault syncs
  between devices (Syncthing, Obsidian Sync, …) doesn't matter to the importer.
- **Astro** renders the site from `src/content/blog/`.
- **GitHub** holds the history; going live is a commit you make.

---

## 1. One-time setup

### Vault layout

```
ninjatronics-v2/                     (the Obsidian vault)
├── articles/                        ← the ONLY folder the importer reads
│   ├── platform-engineering/
│   │   ├── Error Budgets.md
│   │   └── assets/                  ← images for notes in this folder
│   ├── linux/
│   ├── automation/
│   ├── security/
│   ├── gitops/
│   └── infrastructure-as-code/
├── templates/article.md             ← copy of docs/obsidian/article-template.md
└── (anything else: inbox/, private/, journal/ …)   ← never read
```

Category folders must match the categories in `src/config/categories.ts`.

### Obsidian settings

- **Files & links → Default location for new attachments:** "In subfolder under
  current folder", subfolder name `assets`. Pasted images then land where the
  importer looks.
- **Templates (core plugin):** template folder `templates`. Insert
  `templates/article.md` into new articles.
- Wikilinks and Markdown links both work; leave "Use [[Wikilinks]]" as you like.

### Website repo

Tell the importer where the vault is. This file is gitignored:

```json
// obsidian.local.json (repo root; see obsidian.local.example.json)
{ "vault": "/absolute/path/to/your/Obsidian/ninjatronics-v2" }
```

Alternatives: `NINJATRONICS_VAULT=/path npm run import:check`, or
`npm run import:check -- --vault /path`.

---

## 2. Writing an article

Create the note in `articles/<category>/` from the template. Fill in the
properties:

| Property | Required | Notes |
|---|---|---|
| `publish` | yes | `true` makes the note eligible for import. Anything else: ignored. |
| `draft` | yes | `false` publishes the note on import. Keep `true` while writing: a draft is skipped unless `importDraft` is `true`. |
| `importDraft` | no | `true` (with `publish: true` and `draft: true`) imports the note **as a draft**: it's written to the repo with `draft: true` and never built into the site (§3.1). Off by default. `importDraft: true` with `draft: false` is an error. |
| `slug` | yes | The URL: `/blog/<slug>`. Lowercase-hyphenated. Doesn't change if you rename the note. |
| `title` | yes | ≤120 characters. The page title; don't repeat it as `# Title` (a matching first-line H1 is removed). |
| `description` | yes | ≤160 characters. Used in listings, search results, and social previews. |
| `pubDate` | yes | `YYYY-MM-DD`. For migrated posts, the **original** date. |
| `updatedDate` | no | `YYYY-MM-DD`, not before `pubDate`. |
| `category` | yes | Must match the note's folder. |
| `tags` | no | Lowercase-hyphenated, no `#`. |
| `cover`, `coverAlt` | no | `cover: "[[cover.png]]"` or `cover: assets/cover.png`. Alt text required. |
| `toc` | no | Force the table of contents on/off (default: on with 3+ `##` sections). |
| `legacyUrls` | no | Old URLs that should 301 here, e.g. `["/2023/05/error-budgets/"]`. |
| `aliases`, `cssclasses` | no | Obsidian-only, allowed, not published. |

Any other property is an error, so typos like `pubdate` are caught.

### Supported Obsidian syntax

| You write | On the site |
|---|---|
| `[[Other Note]]`, `[[Other Note\|text]]` | Link to that article (its title, or your text) |
| `[[Other Note#Heading]]`, `[[#Heading]]` | Link to that section |
| `[text](Other%20Note.md)` | Same as a wikilink |
| `![[diagram.png\|What the diagram shows]]` | Image, copied and optimized. **Alt text required.** |
| `![What it shows](assets/diagram.png)` | Same |
| `> [!note] Title`, `> [!tip]`, `> [!warning]` | Callout (also: info, hint, caution, danger, important…) |
| `==highlight==` | Highlighted text |
| `%% private %%`, `<!-- private -->` | **Removed.** Safe for notes to self. |
| `^block-id` | Removed |
| Fenced code with a language | Highlighted code with a copy button. `$ ` prompts are stripped on copy. |
| Fenced code without a language | Plain, unhighlighted text. **Always name the language** after the opening fence: `bash` for commands, `nix`, `yaml`, `json`, `powershell`, `markdown`, and `text` for output, directory trees, and paths. Don't pick a language just to get colors. |

**Rejected with an explanation** (the import stops; nothing is written):
links to notes that aren't published (or don't exist, or are outside
`articles/`), links to missing headings or block references, note embeds
(`![[Other Note]]`), non-image attachments, images without alt text or
missing from the note's folder or `assets/`, `dataview`/`tasks` blocks,
unsupported callout types, nested callouts, unclosed `%%` comments, `# ` headings
in the body, symlinks, and paths that leave `articles/`.

Warnings (import continues): inline `#tags` (site tags come from properties
only), image sizes (`|400` is ignored), remote images, mermaid blocks.

---

## 3. Publishing

Run these on a Linux or Mac machine with the website repo and an up-to-date
vault.

1. **Mark the note ready:** `publish: true`, `draft: false`.
2. **Preview the import (read-only):**
   ```bash
   npm run import:check
   ```
   Shows what would be created (`+`), updated (`~`), or unchanged (`=`), drafts
   skipped, and any errors. Writes nothing.
3. **Import:**
   ```bash
   npm run import
   ```
   Writes `src/content/blog/<slug>/index.md` and its images. Refuses if there
   are any errors. Running it again with no vault changes writes nothing.
4. **Validate:**
   ```bash
   npm run check && npm test && npm run build
   ```
5. **Review:** `npm run dev`, open http://localhost:4321/blog/<slug>, then
   `git diff` / `git status`.
6. **Go live:** commit and push. The importer never commits, pushes, or deploys.

### 3.1 Importing a note as a draft (optional)

To stage an article in the repo before publishing it (for example, migrated
content you want to review in git first), set all three:

```yaml
publish: true
draft: true
importDraft: true
```

`npm run import` then writes it with `draft: true`, and the plan shows it as
`[draft]`. A draft article is validated by the build but **never appears on
the site**: no page, listing, tag or category entry, RSS item, sitemap entry,
or redirect (its `legacyUrls` only take effect once it's published). Preview
it with `npm run dev`, where it shows a DRAFT label.

> [!warning] Imported drafts are public in the repository
> The website repository is public on GitHub. An imported draft isn't on the
> site, but anyone can read its text in the repository. Only use
> `importDraft` for content you're comfortable showing in source form. Keep
> private work-in-progress as a plain draft (no `importDraft`): it never
> leaves the vault.

**To publish it later:** set `draft: false` and remove `importDraft` (or set
it to `false`), then import. The plan labels the change
`[draft → PUBLISHED]` so it stands out in review. Going live still needs a
commit, a reviewed pull request, and an approved deployment.

Imported files start with a "Generated by `npm run import`" comment and an
`importedFrom` field. Don't edit them in the repo: the next import overwrites
them. Edit the vault note and re-import.

### Ownership rules

- The importer only writes folders it created (those with `importedFrom`).
- Articles written directly in the repo (no `importedFrom`, e.g. the
  `style-guide` fixture) are never overwritten or deleted. A note whose slug
  collides with one is rejected.
- Renaming or moving a note keeps its article (same `slug`), reported as a rename.
- Imported drafts follow the same rules: their slugs must be unique, they
  can't take a manually maintained article's slug, and renames are tracked.
- A published article can't link to an imported draft (its page doesn't
  exist on the site). A draft can link to published articles and other
  imported drafts.

---

## 4. Unpublishing and rollback

**Turn a published article back into a draft (keep its files in the repo):**
set `draft: true` and `importDraft: true`, then import. The plan labels the
change `[published → draft]`; after the next deployment it's gone from the
site, including its redirects.

**Take an article down (keep it in the vault):**

1. In the vault, set `draft: true` without `importDraft` (or `publish: false`).
2. `npm run import:check` lists it as `! stale`. A normal import keeps it.
3. `npm run import -- --prune` asks you to type `prune`, then deletes only the
   stale imported folders. (`--yes` skips the prompt for scripted use.)
4. Rebuild, review, commit, push.
5. If the URL was public, consider a redirect in `src/config/redirects.ts` so
   old links don't 404.

**Undo a bad publish quickly:** revert the commit that imported it, then push:

```bash
git log --oneline -- src/content/blog/<slug>   # find the commit
git revert <commit>
```

Once deployment exists (Milestone 5), Cloudflare can also roll back instantly
to the previous deployment from its dashboard, without a rebuild.

---

## 5. Writing directly in the repo (secondary)

Articles can still be added by hand as `src/content/blog/<slug>/index.md(x)`
with the same frontmatter (minus `publish`/`slug`; the folder name is the slug).
MDX allows `<Callout type="note">…</Callout>` without an import. Hand-written
articles are never touched by the importer. Use `draft: true` to preview them
in `npm run dev` only.

`src/content/blog/style-guide/` is a permanent draft fixture that exercises
every formatting feature. Never set it to `draft: false`.
