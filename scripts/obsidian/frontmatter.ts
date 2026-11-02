// Strict YAML-subset frontmatter parser and serializer for Obsidian notes.
//
// Supports what Obsidian's Properties editor writes:
//   key: plain scalar | "double quoted" | 'single quoted'
//   key: true | false | null | ~ | (empty)
//   key: [flow, "list"]
//   key:
//     - block
//     - list
//   # comments
// Anything else (nested maps, multi-line strings, anchors) is rejected with the
// line number. A full YAML library would be a new dependency, and articles never
// need more than this.

export type Scalar = string | boolean | null;
export type Value = Scalar | Scalar[];

export interface ParsedNote {
  data: Record<string, Value>;
  body: string;
  /** 1-based line number where the body starts, for error messages. */
  bodyStartLine: number;
}

export class FrontmatterError extends Error {}

const KEY_LINE = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/;

export function splitFrontmatter(source: string): { yaml: string; body: string; bodyStartLine: number } | undefined {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) throw new FrontmatterError("frontmatter opened with '---' but never closed");
  const afterClose = text.indexOf("\n", end + 4);
  const closeLine = text.slice(end + 1, afterClose === -1 ? undefined : afterClose);
  if (closeLine.trim() !== "---") throw new FrontmatterError("frontmatter closing '---' must be on its own line");
  const yaml = text.slice(4, end + 1);
  const body = afterClose === -1 ? "" : text.slice(afterClose + 1);
  return { yaml, body, bodyStartLine: yaml.split("\n").length + 2 };
}

function stripComment(value: string): string {
  // A " #" starts a comment in a plain scalar.
  const index = value.search(/\s#/);
  return index === -1 ? value : value.slice(0, index).trimEnd();
}

function parseScalar(raw: string, line: number): Scalar {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const end = value.lastIndexOf('"');
    if (end === 0) throw new FrontmatterError(`line ${line}: unterminated double-quoted string`);
    const rest = value.slice(end + 1).trim();
    if (rest && !rest.startsWith("#")) throw new FrontmatterError(`line ${line}: unexpected text after quoted string`);
    try {
      return JSON.parse(value.slice(0, end + 1)) as string;
    } catch {
      throw new FrontmatterError(`line ${line}: invalid escape in double-quoted string`);
    }
  }
  if (value.startsWith("'")) {
    const match = value.match(/^'((?:[^']|'')*)'\s*(#.*)?$/);
    if (!match) throw new FrontmatterError(`line ${line}: unterminated single-quoted string`);
    return match[1].replace(/''/g, "'");
  }
  const plain = stripComment(value);
  if (/^[|>]/.test(plain)) throw new FrontmatterError(`line ${line}: multi-line strings (| or >) are not supported; use one line`);
  if (/^[{&*!]/.test(plain)) throw new FrontmatterError(`line ${line}: YAML maps, anchors, and tags are not supported`);
  if (plain === "" || plain === "null" || plain === "~") return null;
  if (plain === "true") return true;
  if (plain === "false") return false;
  return plain;
}

function splitFlowList(inner: string, line: number): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else if (char === "[" || char === "{") {
      throw new FrontmatterError(`line ${line}: nested lists or maps are not supported`);
    } else {
      current += char;
    }
  }
  if (quote) throw new FrontmatterError(`line ${line}: unterminated quote in list`);
  if (current.trim() || items.length) items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

export function parseYamlSubset(yaml: string, firstLine = 2): Record<string, Value> {
  const data: Record<string, Value> = {};
  const lines = yaml.split("\n");
  let listKey: string | null = null;
  /** Keys written as `key:` with nothing after: a block list, or an empty value. */
  const openedBlock = new Set<string>();

  lines.forEach((rawLine, index) => {
    const line = firstLine + index;
    if (/^\s*(#.*)?$/.test(rawLine)) return; // blank or comment

    const listItem = rawLine.match(/^\s+-(?:\s+(.*))?$/) ?? rawLine.match(/^-(?:\s+(.*))?$/);
    if (listItem) {
      if (!listKey) throw new FrontmatterError(`line ${line}: list item without a key above it`);
      const scalar = parseScalar(listItem[1] ?? "", line);
      if (scalar === null) throw new FrontmatterError(`line ${line}: empty list item`);
      (data[listKey] as Scalar[]).push(scalar);
      return;
    }

    if (/^\s/.test(rawLine)) {
      throw new FrontmatterError(`line ${line}: nested properties are not supported ("${rawLine.trim()}")`);
    }

    const match = rawLine.match(KEY_LINE);
    if (!match) throw new FrontmatterError(`line ${line}: expected "key: value", got "${rawLine.trim()}"`);
    const [, key, rawValue = ""] = match;
    if (key in data) throw new FrontmatterError(`line ${line}: duplicate property "${key}"`);

    const value = rawValue.trim();
    if (value.startsWith("[")) {
      const close = value.lastIndexOf("]");
      if (close === -1) throw new FrontmatterError(`line ${line}: unterminated list "${value}"`);
      const rest = value.slice(close + 1).trim();
      if (rest && !rest.startsWith("#")) throw new FrontmatterError(`line ${line}: unexpected text after list`);
      data[key] = splitFlowList(value.slice(1, close), line).map((item) => {
        const scalar = parseScalar(item, line);
        if (scalar === null) throw new FrontmatterError(`line ${line}: empty list item`);
        return scalar;
      });
      listKey = null;
      return;
    }

    if (stripComment(value) === "") {
      // Either an empty value or the start of a block list.
      data[key] = [];
      listKey = key;
      openedBlock.add(key);
      return;
    }

    data[key] = parseScalar(value, line);
    listKey = null;
  });

  // `key:` followed by no list items is an empty value, not an empty list.
  for (const key of openedBlock) {
    if ((data[key] as Scalar[]).length === 0) data[key] = null;
  }
  return data;
}

export function parseNote(source: string): ParsedNote | undefined {
  const split = splitFrontmatter(source);
  if (!split) return undefined;
  return { data: parseYamlSubset(split.yaml), body: split.body, bodyStartLine: split.bodyStartLine };
}

/** Deterministic YAML for the generated site article. Strings use JSON quoting (valid YAML). */
export function serializeFrontmatter(entries: Array<[string, unknown]>, headerComment: string[]): string {
  const lines = ["---", ...headerComment.map((c) => `# ${c}`)];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`);
    } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && /Date$/.test(key)) {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
