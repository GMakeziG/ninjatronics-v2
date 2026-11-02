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
| `draft` | yes | Must be `false` to import. Keep `true` while writing. |
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

Imported files start with a "Generated by `npm run import`" comment and an
`importedFrom` field. Don't edit them in the repo: the next import overwrites
them. Edit the vault note and re-import.

### Ownership rules

- The importer only writes folders it created (those with `importedFrom`).
- Articles written directly in the repo (no `importedFrom`, e.g. the
  `style-guide` fixture) are never overwritten or deleted. A note whose slug
  collides with one is rejected.
- Renaming or moving a note keeps its article (same `slug`), reported as a rename.

---

## 4. Unpublishing and rollback

**Take an article down (keep it in the vault):**

1. In the vault, set `draft: true` (or `publish: false`).
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
