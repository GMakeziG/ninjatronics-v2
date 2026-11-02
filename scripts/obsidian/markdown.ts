// Converts Obsidian-flavored Markdown to standard Markdown for the site.
// Fenced code blocks and inline code are never modified. Unsupported syntax
// produces an error naming the line, not a silent drop.
//
//   %% comment %%, <!-- comment -->   removed (private asides never publish)
//   [[Note]], [[Note#Heading|text]]   → [text](/blog/<slug>#heading), target must be published
//   [text](Other%20Note.md)           → same, for Markdown-style note links
//   ![[image.png|Alt text]]           → ![Alt text](./image.png), image copied
//   ![Alt](assets/image.png)          → ![Alt](./image.png), image copied
//   > [!note|tip|warning] Title       → site callout markup
//   ==highlight==                     → <mark>highlight</mark>
//   ^block-id                         → removed
//   # Title (first line, = title)     → removed (the page title comes from frontmatter)

export interface NoteRef {
  slug: string;
  title: string;
  anchors: Set<string>;
}

export type Resolution<T> = { ok: true; value: T } | { ok: false; error: string };

export interface TransformContext {
  title: string;
  /** Anchors (heading ids) of this note, for same-note [[#Heading]] links. */
  selfAnchors: Set<string>;
  /** Resolve a wikilink target ("Note", "linux/Note", "Note.md") to a published note. */
  resolveWikilink(target: string): Resolution<NoteRef>;
  /** Resolve a relative Markdown link to a .md file. */
  resolveMarkdownLink(relativePath: string): Resolution<NoteRef>;
  /** Resolve an image reference (embed name or relative path) to a safe file. */
  resolveImage(ref: string, form: "embed" | "path"): Resolution<string>;
}

export interface TransformResult {
  body: string;
  /** Absolute source path → file name inside the article folder. */
  assets: Map<string, string>;
  errors: string[];
  warnings: string[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const SIZE_ONLY = /^\d+(x\d+)?$/;
const CALLOUT_TYPES: Record<string, "note" | "tip" | "warning"> = {
  note: "note",
  info: "note",
  abstract: "note",
  summary: "note",
  tip: "tip",
  hint: "tip",
  success: "tip",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  danger: "warning",
  important: "warning",
};
const CALLOUT_LABELS = { note: "Note", tip: "Tip", warning: "Warning" } as const;
const UNSUPPORTED_FENCES = new Set(["dataview", "dataviewjs", "query", "tasks"]);

/** Heading anchor compatible with Astro's slugger (github-slugger rules). */
export function headingSlug(text: string): string {
  return plainHeadingText(text)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

function plainHeadingText(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*~]|==/g, "")
    .replace(/(^|\s)_+|_+(\s|$)/g, "$1$2");
}

/** Heading anchors for a note body, de-duplicated the way Astro does (-1, -2…). */
export function collectAnchors(body: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/);
    if (!heading) continue;
    const base = headingSlug(heading[1]);
    const seen = counts.get(base) ?? 0;
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
    counts.set(base, seen + 1);
  }
  return anchors;
}

/** Splits a body into alternating text and fenced-code segments. */
function segments(body: string): Array<{ code: boolean; text: string; line: number; info?: string }> {
  const out: Array<{ code: boolean; text: string; line: number; info?: string }> = [];
  const lines = body.split("\n");
  let buffer: string[] = [];
  let start = 1;
  let fence: string | null = null;
  let info = "";
  const flush = (code: boolean, next: number) => {
    if (buffer.length) out.push({ code, text: buffer.join("\n"), line: start, info: code ? info : undefined });
    buffer = [];
    start = next;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && m) {
      flush(false, n);
      fence = m[1];
      info = m[2].trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      buffer.push(line);
    } else if (fence && m && m[1][0] === fence[0] && m[1].length >= fence.length && m[2].trim() === "") {
      buffer.push(line);
      flush(true, n + 1);
      fence = null;
    } else {
      buffer.push(line);
    }
  });
  flush(fence !== null, lines.length + 1);
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAlt(text: string): string {
  return text.replace(/[[\]]/g, "\\$&");
}

function assetName(abs: string, used: Map<string, string>, assets: Map<string, string>): string {
  const existing = assets.get(abs);
  if (existing) return existing;
  const base = abs.split("/").pop() ?? "image";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "image";
  const ext = (dot > 0 ? base.slice(dot) : "").toLowerCase();
  let name = `${stem}${ext}`;
  for (let n = 2; used.has(name) && used.get(name) !== abs; n++) name = `${stem}-${n}${ext}`;
  used.set(name, abs);
  assets.set(abs, name);
  return name;
}

export function transformBody(input: string, ctx: TransformContext, startLine = 1): TransformResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const assets = new Map<string, string>();
  const usedNames = new Map<string, string>();
  const at = (line: number) => `line ${startLine + line - 1}`;

  const imageMarkdown = (alt: string, ref: string, form: "embed" | "path", line: number): string => {
    if (!alt.trim()) {
      errors.push(`${at(line)}: image "${ref}" has no alt text. Write ![[${ref}|Describe the image]] or ![Describe the image](${ref}).`);
      return "";
    }
    const resolved = ctx.resolveImage(ref, form);
    if (!resolved.ok) {
      errors.push(`${at(line)}: ${resolved.error}`);
      return "";
    }
    return `![${escapeAlt(alt.trim())}](./${assetName(resolved.value, usedNames, assets)})`;
  };

  const linkTo = (note: NoteRef, heading: string | undefined, line: number, raw: string): string | undefined => {
    if (!heading) return `/blog/${note.slug}`;
    const anchor = headingSlug(heading);
    if (!note.anchors.has(anchor)) {
      errors.push(`${at(line)}: ${raw} links to heading "${heading}", which doesn't exist in "${note.title}".`);
      return undefined;
    }
    return `/blog/${note.slug}#${anchor}`;
  };

  const out: string[] = [];
  let firstContent = true;

  for (const seg of segments(input.replace(/\r\n?/g, "\n"))) {
    if (seg.code) {
      if (seg.info && UNSUPPORTED_FENCES.has(seg.info)) {
        errors.push(`${at(seg.line)}: \`\`\`${seg.info} blocks are Obsidian plugin queries and can't be published. Replace the block with its results as plain Markdown.`);
      }
      if (seg.info === "mermaid") warnings.push(`${at(seg.line)}: mermaid diagrams render as code on the site.`);
      out.push(seg.text);
      firstContent = false;
      continue;
    }

    // Protect inline code spans, and (later) generated output, from every
    // subsequent pass. Placeholders are restored at the end.
    const protectedText: string[] = [];
    const protect = (value: string) => (value ? `\u0000${protectedText.push(value) - 1}\u0000` : "");
    let text = seg.text.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (m) => protect(m));

    // Private comments: removed before anything else can see them.
    text = text.replace(/%%[\s\S]*?%%/g, "");
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    const lineOf = (index: number) => seg.line + text.slice(0, index).split("\n").length - 1;
    const strayComment = text.indexOf("%%");
    if (strayComment !== -1) errors.push(`${at(lineOf(strayComment))}: unclosed %% comment. Close it with %% so private text isn't published.`);
    const strayHtml = text.indexOf("<!--");
    if (strayHtml !== -1) errors.push(`${at(lineOf(strayHtml))}: unclosed <!-- comment.`);

    // Line-based passes: H1 handling, callouts, block ids.
    const lines = text.split("\n");
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineNo = seg.line + i;
      let line = lines[i];

      if (firstContent && line.trim() !== "") {
        firstContent = false;
        const h1 = line.match(/^#[ \t]+(.+?)[ \t#]*$/);
        if (h1 && h1[1].trim().toLowerCase() === ctx.title.trim().toLowerCase()) continue; // duplicate of the title
      }
      if (/^#[ \t]+\S/.test(line)) {
        errors.push(`${at(lineNo)}: "# ${line.slice(1).trim()}" is a top-level heading. The page title comes from frontmatter; use ## for sections.`);
      }

      const callout = line.match(/^>[ \t]*\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/);
      if (callout) {
        const type = CALLOUT_TYPES[callout[1].toLowerCase()];
        if (!type) {
          errors.push(`${at(lineNo)}: callout type "[!${callout[1]}]" isn't supported. Use [!note], [!tip], or [!warning] (or info/hint/caution/danger).`);
        }
        const inner: string[] = [];
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) {
          const content = lines[++i].replace(/^>[ \t]?/, "");
          if (/^>[ \t]*\[!/.test(content)) errors.push(`${at(seg.line + i)}: nested callouts aren't supported.`);
          inner.push(content);
        }
        const kind = type ?? "note";
        const title = callout[3].trim();
        result.push(
          "",
          `<aside class="callout callout--${kind}" role="note" aria-label="${escapeHtml(title || CALLOUT_LABELS[kind])}">`,
          `<p class="callout__label">${CALLOUT_LABELS[kind]}${title ? `<span class="callout__title">: ${escapeHtml(title)}</span>` : ""}</p>`,
          `<div class="callout__body">`,
          "",
          ...inner,
          "",
          `</div>`,
          `</aside>`,
          "",
        );
        continue;
      }

      // Block reference ids (^abc123) at the end of a line or on their own line.
      line = line.replace(/(^|\s)\^[A-Za-z0-9-]+\s*$/, "");
      result.push(line);
    }
    text = result.join("\n");

    // Image embeds and transclusions: ![[target#part|options]]
    text = text.replace(/!\[\[([^\]]+)\]\]/g, (raw, inner: string, offset: number) => {
      const line = lineOf(offset);
      const [targetPart, ...options] = inner.split("|");
      const target = targetPart.trim();
      if (!IMAGE_EXT.test(target.split("#")[0])) {
        if (/\.[a-z0-9]+$/i.test(target)) {
          errors.push(`${at(line)}: ${raw} embeds a non-image attachment. Only images can be published.`);
        } else {
          errors.push(`${at(line)}: ${raw} embeds another note. Note embeds can't be published; copy the content or link to it with [[…]].`);
        }
        return "";
      }
      const altParts = options.map((o) => o.trim()).filter((o) => o && !SIZE_ONLY.test(o));
      if (options.some((o) => SIZE_ONLY.test(o.trim()))) warnings.push(`${at(line)}: image size in ${raw} is ignored; images scale to the reading width.`);
      return protect(imageMarkdown(altParts.join(" "), target, "embed", line));
    });

    // Markdown images: ![alt](path) and ![alt](<path with spaces>)
    text = text.replace(/!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g, (raw, alt: string, angled?: string, bare?: string, offset?: number) => {
      const ref = (angled ?? bare ?? "").trim();
      if (/^https?:\/\//i.test(ref)) {
        warnings.push(`${at(lineOf(offset ?? 0))}: remote image ${ref} is not optimized or archived with the article.`);
        if (!alt.trim()) errors.push(`${at(lineOf(offset ?? 0))}: image "${ref}" has no alt text.`);
        return protect(raw);
      }
      let decoded = ref;
      try {
        decoded = decodeURIComponent(ref);
      } catch {
        // keep as-is
      }
      return protect(imageMarkdown(alt, decoded, "path", lineOf(offset ?? 0)));
    });

    // Wikilinks: [[target#heading|text]]
    text = text.replace(/\[\[([^\]]+)\]\]/g, (raw, inner: string, offset: number) => {
      const line = lineOf(offset);
      const [targetPart, ...aliasParts] = inner.split("|");
      const alias = aliasParts.join("|").trim();
      const [notePart, ...headingParts] = targetPart.split("#");
      const heading = headingParts.join("#").trim() || undefined;
      if (heading?.startsWith("^")) {
        errors.push(`${at(line)}: ${raw} links to a block reference, which can't be published. Link to the note or a heading instead.`);
        return alias || notePart;
      }
      if (/\.(?!md$)[a-z0-9]+$/i.test(notePart.trim())) {
        errors.push(`${at(line)}: ${raw} links to an attachment. Only images (as embeds) can be published.`);
        return alias || notePart;
      }
      if (!notePart.trim()) {
        // Same-note heading link.
        const anchor = headingSlug(heading ?? "");
        if (!ctx.selfAnchors.has(anchor)) errors.push(`${at(line)}: ${raw} links to a heading that doesn't exist in this note.`);
        return `[${alias || heading}](#${anchor})`;
      }
      const resolved = ctx.resolveWikilink(notePart.trim());
      if (!resolved.ok) {
        errors.push(`${at(line)}: ${raw}: ${resolved.error}`);
        return alias || notePart;
      }
      const href = linkTo(resolved.value, heading, line, raw);
      return href ? `[${alias || resolved.value.title}](${href})` : alias || notePart;
    });

    // Markdown links to local .md notes: [text](Note.md#heading)
    text = text.replace(/(?<!!)\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)/g, (raw, label: string, angled?: string, bare?: string, offset?: number) => {
      const href = (angled ?? bare ?? "").trim();
      if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return raw; // external, site-absolute, or same-page
      const line = lineOf(offset ?? 0);
      const [pathPart, fragment] = href.split("#");
      let decoded = pathPart;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        // keep as-is
      }
      if (!/\.md$/i.test(decoded)) {
        errors.push(`${at(line)}: ${raw} links to a local file. Only links to other published notes, or to web URLs, are supported.`);
        return label;
      }
      const resolved = ctx.resolveMarkdownLink(decoded);
      if (!resolved.ok) {
        errors.push(`${at(line)}: ${raw}: ${resolved.error}`);
        return label;
      }
      const target = linkTo(resolved.value, fragment ? decodeURIComponent(fragment) : undefined, line, raw);
      return target ? `[${label}](${target})` : label;
    });

    // Highlights.
    text = text.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");

    // Inline #tags are not site tags; flag them so they're not mistaken for frontmatter tags.
    for (const m of text.matchAll(/(^|\s)#([A-Za-z][\w/-]*)/gm)) {
      warnings.push(`${at(lineOf(m.index ?? 0))}: inline tag #${m[2]} stays as plain text. Site tags come from frontmatter only.`);
    }

    // Tidy blank-line runs left by removed comments and callout markup. Safe:
    // this segment is prose only; fenced code is a separate segment.
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => protectedText[Number(i)]);
    out.push(text);
  }

  // Only trim the ends; collapsing blank lines here would alter code blocks.
  const body = out.join("\n").replace(/^\n+|\s+$/g, "") + "\n";
  return { body, assets, errors, warnings };
}
