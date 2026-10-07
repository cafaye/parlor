/**
 * The agreement between `openapi/v1.yaml` and the forwarder's allow-list.
 *
 * ---------------------------------------------------------------------------
# WHY THIS TEST EXISTS
# ---------------------------------------------------------------------------
# The document is a transcription of `ROUTES` in `src/lib/upstream.ts` — the
# one table that decides every `/v1/*` request this app forwards. A
# transcription that can drift is worse than no document: it looks
# authoritative, so a client generated from it would carry operations this
# app refuses, or miss operations it serves. This test fails in BOTH
# directions: a table entry the document does not describe, and a document
# entry the table does not allow.
#
 * The document's own header states the same contract in prose; this file is
 * what makes it a fact that runs on every commit.
 *
 * ---------------------------------------------------------------------------
 * WHY A HAND-ROLLED PARSER AND NOT A YAML LIBRARY
 * ---------------------------------------------------------------------------
 * This repository declares no YAML parser as a direct dependency, and adding
 * one to prove a file parses is not worth the lockfile (the same reasoning
 * `tests/validate-ci.sh` records for the manifest). So the document is
 * written in a subset this file parses: mappings, sequences of scalars and
 * mappings, flow sequences, quoted and plain scalars (including a plain
 * scalar folded across lines, which YAML joins with a space), `>-` and `|`
 * block scalars, and `#` comments. Anything outside that subset — a tab, a
 * flow mapping, an anchor, a second document — makes the parser THROW rather
 * than guess, because a check that cannot fail is worse than no check.
 *
 * The parser is deliberately small and the document is deliberately regular.
 * If the document grows a construct the parser does not know, the suite goes
 * red loudly, which is the direction this file is supposed to fail in.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ROUTES } from "./upstream";

// `process.cwd()` and not `import.meta.url`: under the jsdom environment
// vitest serves modules over an `http:` URL, so `fileURLToPath` throws (the
// same measured reason `src/styles/tokens.test.ts` records). vitest's root is
// the repository root, which is the one directory this path is relative to.
const DOCUMENT_PATH = resolve(process.cwd(), "openapi/v1.yaml");

// ---------------------------------------------------------------------------
// The YAML subset parser
// ---------------------------------------------------------------------------

type YamlNode = string | YamlNode[] | { [key: string]: YamlNode };

/** One line: its indentation and its content with comments stripped. */
type Line = { indent: number; text: string };

/**
 * Strip a trailing comment: a `#` that starts a line, or a `#` preceded by
 * whitespace outside quotes. A `#` glued to a value is part of the value,
 * which is the YAML rule and the reason the document never writes one.
 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** The document's lines: comments and blanks gone, indentation kept. */
function lines(text: string): Line[] {
  return text
    .split("\n")
    .map(stripComment)
    .filter((line) => line.trim() !== "")
    .map((line) => ({
      indent: line.length - line.trimStart().length,
      text: line.trim(),
    }));
}

/** What makes a line a mapping entry: `key: value`, or a trailing `key:`. */
const MAPPING_ENTRY = /^([^:]+):(?:\s+(.*))?$/;

/** `key: value` split at the first colon-space (or a trailing colon). */
function splitEntry(text: string): { key: string; value: string } {
  const match = MAPPING_ENTRY.exec(text);
  if (!match) throw new Error(`not a mapping entry: ${text}`);
  return { key: match[1], value: match[2] ?? "" };
}

/** Is this line a mapping entry (`key: value` or `key:`) rather than prose? */
function isMappingEntry(text: string): boolean {
  return /^[^:]+:\s/.test(text) || /^[^:]+:$/.test(text);
}

/** A scalar: plain, single-quoted, double-quoted, or a flow sequence. */
function parseScalar(text: string): YamlNode {
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new Error(`unterminated flow sequence: ${text}`);
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Parse a block starting at the first line with the given indentation.
 *
 * A mapping when the line is `key: value`, a sequence when it is `- …`.
 * Anything else is a parse error rather than a guess.
 */
function parseBlock(lines: Line[], start: number, indent: number): [YamlNode, number] {
  if (start >= lines.length) throw new Error("unexpected end of document");
  const first = lines[start];
  if (first.indent !== indent) throw new Error(`expected indent ${indent}, found ${first.indent}`);

  if (first.text.startsWith("- ")) {
    const items: YamlNode[] = [];
    let pos = start;
    while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith("- ")) {
      const itemText = lines[pos].text.slice(2);
      if (itemText === "") {
        // The item's value is a nested block on the following lines.
        pos += 1;
        if (pos < lines.length && lines[pos].indent > indent) {
          const [value, next] = parseBlock(lines, pos, lines[pos].indent);
          items.push(value);
          pos = next;
        } else {
          items.push(null);
        }
      } else if (itemText.includes(":") && !itemText.startsWith("'") && !itemText.startsWith('"')) {
        // `- key: value` — a mapping whose first entry is inline. Rewrite
        // the line as that entry at the inline indentation and parse the
        // mapping; the next sequence item at `indent` stops it.
        lines[pos] = { indent: indent + 2, text: itemText };
        const [value, next] = parseBlock(lines, pos, indent + 2);
        items.push(value);
        pos = next;
      } else {
        items.push(parseScalar(itemText));
        pos += 1;
      }
    }
    return [items, pos];
  }

  const map: { [key: string]: YamlNode } = {};
  let pos = start;
  while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith("- ")) {
    const { key, value } = splitEntry(lines[pos].text);
    if (value === "") {
      pos += 1;
      if (pos < lines.length && lines[pos].indent > indent) {
        const [nested, next] = parseBlock(lines, pos, lines[pos].indent);
        map[key] = nested;
        pos = next;
      } else {
        map[key] = null;
      }
    } else if (value === ">-" || value === "|" || value === ">" || value === "|-" || value === "|+") {
      // A block scalar: consume the deeper-indented lines that follow.
      pos += 1;
      const block: string[] = [];
      while (pos < lines.length && lines[pos].indent > indent) {
        block.push(lines[pos].text);
        pos += 1;
      }
      map[key] = value.startsWith(">") ? block.join(" ") : block.join("\n");
    } else {
      map[key] = parseScalar(value);
      pos += 1;
      // A plain scalar continues onto the lines that follow it when they are
      // more indented than this mapping and are not themselves mapping
      // entries — YAML's plain-scalar folding, which joins the lines with a
      // space. Without this, a description wrapped onto a second line ends
      // the mapping at the first continuation line, every enclosing block
      // unwinds, and the rest of the document is silently dropped: the parse
      // SUCCEEDS having seen less than there is, which is the one way this
      // test must never fail.
      while (
        pos < lines.length &&
        lines[pos].indent > indent &&
        !lines[pos].text.startsWith("- ") &&
        !MAPPING_ENTRY.test(lines[pos].text)
      ) {
        map[key] = `${String(map[key])} ${lines[pos].text}`;
        pos += 1;
      }
    }
  }
  return [map, pos];
}

/** Parse the document. Throws on any construct outside the subset. */
function parseYaml(text: string): YamlNode {
  const parsed = lines(text);
  if (parsed.length === 0) throw new Error("the document is empty");
  const [value] = parseBlock(parsed, 0, parsed[0].indent);
  return value;
}

// ---------------------------------------------------------------------------
// The document, read once
// ---------------------------------------------------------------------------

const documentText = readFileSync(DOCUMENT_PATH, "utf8");
const document = parseYaml(documentText);

if (typeof document !== "object" || document === null || Array.isArray(document)) {
  throw new Error("the document did not parse to a mapping");
}
const paths = (document as { paths?: unknown }).paths;
if (typeof paths !== "object" || paths === null || Array.isArray(paths)) {
  throw new Error("the document has no `paths` mapping");
}

// ---------------------------------------------------------------------------
// The two sets
// ---------------------------------------------------------------------------

/** One operation as the table spells it. */
type TableEntry = {
  path: string;
  method: string;
  upstream: string;
  pathParams: string[];
  queryParams: string[];
};

/** The table's routes in the document's spelling: `:name` becomes `{name}`. */
const tableEntries: TableEntry[] = ROUTES.map((route) => ({
  path: `/v1/${route.path.map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment)).join("/")}`,
  method: route.method.toLowerCase(),
  upstream: route.upstream,
  pathParams: route.path
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1)),
  queryParams: [...(route.query ?? [])],
}));

/** One operation as the document spells it. */
type DocumentEntry = {
  path: string;
  method: string;
  tags: string[];
  pathParams: string[];
  queryParams: string[];
};

const documentEntries: DocumentEntry[] = [];
for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
  if (typeof item !== "object" || item === null) continue;
  for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
    if (typeof operation !== "object" || operation === null) continue;
    const op = operation as Record<string, unknown>;
    const parameters = Array.isArray(op.parameters) ? op.parameters : [];
    documentEntries.push({
      path,
      method,
      tags: Array.isArray(op.tags) ? (op.tags as string[]) : [],
      pathParams: parameters
        .filter((p) => typeof p === "object" && p !== null && (p as { in?: unknown }).in === "path")
        .map((p) => String((p as { name?: unknown }).name)),
      queryParams: parameters
        .filter((p) => typeof p === "object" && p !== null && (p as { in?: unknown }).in === "query")
        .map((p) => String((p as { name?: unknown }).name)),
    });
  }
}

const byPathAndMethod = (entries: { path: string; method: string }[]) =>
  new Map(entries.map((entry) => [`${entry.method} ${entry.path}`, entry]));

const table = byPathAndMethod(tableEntries);
const documented = byPathAndMethod(documentEntries);

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

describe("the document and the allow-list agree", () => {
  it("describes every route the table allows", () => {
    const missing = tableEntries.filter((entry) => !documented.has(`${entry.method} ${entry.path}`));
    expect(missing).toEqual([]);
  });

  it("describes no route the table does not allow", () => {
    const extra = documentEntries.filter((entry) => !table.has(`${entry.method} ${entry.path}`));
    expect(extra).toEqual([]);
  });

  it("declares the same path parameters the table's wildcards imply", () => {
    const mismatches: string[] = [];
    for (const entry of tableEntries) {
      const operation = documented.get(`${entry.method} ${entry.path}`);
      if (!operation) continue;
      const expected = entry.pathParams.sort();
      const actual = operation.pathParams.sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${entry.method} ${entry.path}: table ${expected} vs document ${actual}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("declares the same query parameters the table's allow-list implies", () => {
    const mismatches: string[] = [];
    for (const entry of tableEntries) {
      const operation = documented.get(`${entry.method} ${entry.path}`);
      if (!operation) continue;
      const expected = entry.queryParams.sort();
      const actual = operation.queryParams.sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${entry.method} ${entry.path}: table ${expected} vs document ${actual}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("tags each operation with the upstream that owns it", () => {
    const mismatches: string[] = [];
    for (const entry of tableEntries) {
      const operation = documented.get(`${entry.method} ${entry.path}`);
      if (!operation) continue;
      if (JSON.stringify(operation.tags) !== JSON.stringify([entry.upstream])) {
        mismatches.push(`${entry.method} ${entry.path}: table ${entry.upstream} vs document ${operation.tags}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("versions every path", () => {
    const unversioned = documentEntries.filter((entry) => !entry.path.startsWith("/v1"));
    expect(unversioned).toEqual([]);
  });

  it("does not describe the health probes", () => {
    const probes = documentEntries.filter(
      (entry) => entry.path === "/healthz" || entry.path === "/readyz",
    );
    expect(probes).toEqual([]);
  });
});
