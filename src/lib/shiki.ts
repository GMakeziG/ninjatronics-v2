// Syntax highlighting: a palette-derived Shiki theme plus a transformer that
// wraps each code block in a <figure> with a language label and a copy
// button. Both run at build time; the only client JS is the copy handler
// (src/components/CopyCode.astro), and code stays readable without it.
//
// Contrast on the code background (#171A1D, --surface-card):
//   Warm Paper 14.94:1 · Muted Sage 8.29:1 · Signal Teal 9.36:1 · Vermilion 4.76:1
// Every token color passes WCAG AA for normal text.
import type { ShikiTransformer, ThemeRegistration } from "shiki";

const C = {
  bg: "#171a1d",
  fg: "#f0ede6",
  sage: "#a8b6ae",
  teal: "#2fd3c6",
  vermilion: "#e15a3b",
};

export const ninjatronicsTheme: ThemeRegistration = {
  name: "ninjatronics-dark",
  type: "dark",
  colors: { "editor.background": C.bg, "editor.foreground": C.fg },
  // Token rules go in `tokenColors` only. Shiki reads `settings` first when it
  // exists, so even an empty `settings: []` would discard every rule below.
  tokenColors: [
    { settings: { foreground: C.fg, background: C.bg } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: C.sage, fontStyle: "italic" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "entity.name.tag", "markup.deleted"],
      settings: { foreground: C.vermilion },
    },
    {
      scope: ["string", "string.quoted", "markup.inserted", "entity.other.attribute-name", "support.type.property-name"],
      settings: { foreground: C.teal },
    },
    { scope: ["constant.numeric", "constant.language", "constant.character", "support.constant"], settings: { foreground: C.teal } },
    { scope: ["entity.name.function", "support.function", "entity.name.type", "entity.name.class"], settings: { foreground: C.fg, fontStyle: "bold" } },
    { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: C.sage } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: C.fg } },
    { scope: ["markup.heading", "markup.bold"], settings: { foreground: C.fg, fontStyle: "bold" } },
  ],
};

/** Languages whose copy action strips leading `$ ` prompts. */
export const SHELL_LANGS = ["bash", "sh", "shell", "zsh", "console", "shellsession"];

const LABELS: Record<string, string> = {
  sh: "shell",
  shellsession: "shell",
  console: "shell",
  ts: "typescript",
  js: "javascript",
  yml: "yaml",
  plaintext: "text",
  txt: "text",
};

/**
 * Wraps <pre> in:
 *   <figure class="code-block" data-lang="bash">
 *     <figcaption class="code-block__bar">
 *       <span class="code-block__lang">bash</span>
 *       <button class="code-block__copy" type="button" hidden>Copy</button>
 *     </figcaption>
 *     <pre>…</pre>
 *   </figure>
 * The button stays `hidden` until the copy script enhances it.
 */
/**
 * Shiki writes token colors as inline `style="color:…"` attributes. The site's
 * Content-Security-Policy allows no inline styles, so every declaration is
 * turned into a class (styled in src/styles/prose.css). The theme only uses
 * the palette above, so the mapping is complete; anything unexpected fails
 * the build instead of silently losing highlighting.
 */
const TOKEN_CLASSES: Record<string, string | null> = {
  [`color:${C.fg}`]: null, // the default text color: no class needed
  [`color:${C.sage}`]: "tok-sage",
  [`color:${C.teal}`]: "tok-teal",
  [`color:${C.vermilion}`]: "tok-change",
  [`background-color:${C.bg}`]: null, // the code block background
  "overflow-x:auto": null, // added by Astro; prose.css sets it
  "font-weight:bold": "tok-bold",
  "font-style:italic": "tok-italic",
  "user-select:none": "tok-noselect", // Astro's wrapper around diff +/- markers
};

function styleToClasses(style: unknown): string[] {
  if (typeof style !== "string") return [];
  return style
    .split(";")
    .map((declaration) => declaration.replace(/\s+/g, "").toLowerCase())
    .filter(Boolean)
    .flatMap((declaration) => {
      if (!(declaration in TOKEN_CLASSES)) {
        throw new Error(`src/lib/shiki.ts: no class for code-token style "${declaration}"; add it to TOKEN_CLASSES`);
      }
      const name = TOKEN_CLASSES[declaration];
      return name ? [name] : [];
    });
}

export const codeBlockTransformer: ShikiTransformer = {
  name: "ninjatronics:code-block",
  pre(node) {
    // Keyboard users can scroll wide code horizontally.
    node.properties.tabindex = "0";
  },
  root(root) {
    // Runs after every other hook (including Astro's own), so this sees the
    // final tree: move each inline style to classes.
    const walk = (node: { type: string; properties?: Record<string, unknown>; children?: unknown[] }) => {
      if (node.type === "element" && node.properties && "style" in node.properties) {
        const classes = styleToClasses(node.properties.style);
        delete node.properties.style;
        if (classes.length) {
          const existing = node.properties.className ?? node.properties.class;
          const current = Array.isArray(existing) ? existing.map(String) : typeof existing === "string" ? existing.split(/\s+/) : [];
          delete node.properties.class;
          node.properties.className = [...current.filter(Boolean), ...classes];
        }
      }
      for (const child of node.children ?? []) walk(child as typeof node);
    };
    walk(root);

    const lang = (this.options.lang || "text").toLowerCase();
    const label = LABELS[lang] ?? lang;
    type Node = (typeof root.children)[number];
    type Element = Extract<Node, { type: "element" }>;
    const pre = root.children.find((child): child is Element => child.type === "element" && child.tagName === "pre");
    if (!pre) return;
    root.children = [
      {
        type: "element",
        tagName: "figure",
        properties: { className: ["code-block"], "data-lang": lang, "data-shell": SHELL_LANGS.includes(lang) ? "true" : undefined },
        children: [
          {
            type: "element",
            tagName: "figcaption",
            properties: { className: ["code-block__bar"] },
            children: [
              { type: "element", tagName: "span", properties: { className: ["code-block__lang"] }, children: [{ type: "text", value: label }] },
              {
                type: "element",
                tagName: "button",
                properties: { type: "button", className: ["code-block__copy"], hidden: true, "aria-label": `Copy ${label} code` },
                children: [{ type: "text", value: "Copy" }],
              },
            ],
          },
          pre,
        ],
      },
    ];
  },
};
