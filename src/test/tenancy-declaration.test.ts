import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The ratchet behind `tenancy.yml`, and the reason it has to exist here.
 *
 * `core/harness/bin/tenancy-check .` is the authority on parlor's account
 * boundary, and this repository is not it. What this suite does is hold shut
 * the ONE hole that declaration has, which is a hole in
 * `core/schemas/tenant-isolation.schema.json` rather than in parlor.
 *
 * The schema's `PATH_PATTERN` — `^[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+$` — admits
 * no `[` and no `]`. TanStack Start puts a route parameter in the DIRECTORY
 * NAME, so this repository's parameterised routes live under
 * `src/app/accounts/[accountId]/`, `src/app/invitations/[token]/` and
 * `src/app/v1/[...path]/`, and **a declaration cannot name a path it cannot
 * write**. A site under a bracketed directory therefore cannot be vouched for
 * in `scope.nonRowSites`, and an unvouched site is `tenancy.honest-zero`, a
 * FAILURE.
 *
 * So `tenancy.yml` declares every source path the schema CAN express, which
 * leaves `src/app/invitations/[token]/` outside the scan. That is a real hole
 * and the declaration's header names every line in it. This suite is what
 * stops the hole growing quietly, in the two directions it could:
 *
 *   * a NEW nameable path carrying the key that nobody added to
 *     `scope.sources` — the scan would read past it and stay green, which is
 *     exactly the "darkroom has no routes" defect one directory down;
 *   * the bracketed exception changing shape — a `[token]` gaining a key
 *     reference, or the two known files losing theirs.
 *
 * It also re-derives the vouched site set from the tree, so a `nonRowSites`
 * entry that no longer matches a real line is red here rather than at the next
 * person who reads the declaration.
 *
 * The parser is deliberately small and DELIBERATELY LOUD: every accessor throws
 * when the file is not shaped the way this test expects. A parser that quietly
 * read nothing would make every assertion below vacuously green, which is the
 * failure mode this whole packet exists to prevent.
 */

const REPO = join(import.meta.dirname, "..", "..");
const DECLARATION = join(REPO, "tenancy.yml");

/** The fleet's tenancy key, and the spellings the checker reads it by. */
const KEY = "account_id";
const KEY_SPELLINGS = [KEY, `${KEY}_`, `${KEY}Id`];

/** The schema's `PATH_PATTERN`, restated. Brackets are the whole point. */
const NAMEABLE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** Directories neither the checker nor this test walks. The checker's own
 *  `SKIPPED_DIRECTORIES`, kept beside `node_modules` so the two agree. */
const SKIPPED = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".venv",
  "vendor",
  "target",
  "deps",
  "_build",
  "coverage",
  "__pycache__",
]);

/** Suffixes the checker reads as text. A binary is walked past, not read. */
const TEXT_SUFFIXES = new Set([
  ".sql",
  ".go",
  ".ex",
  ".exs",
  ".rb",
  ".py",
  ".ts",
  ".tsx",
  ".rs",
  ".java",
  ".kt",
  ".php",
  ".cs",
  ".swift",
  ".js",
  ".mjs",
  ".md",
  ".yml",
  ".yaml",
  ".json",
]);

// ---------------------------------------------------------------------------
// the declaration, read
// ---------------------------------------------------------------------------

type Declaration = {
  accountScoped: boolean | null;
  entryPoints: string[];
  scopeKey: string | null;
  sources: string[];
  rlsSources: string[];
  rlsDatabaseEnforced: boolean | null;
  nonRowSites: Array<{ file: string; line: number }>;
};

/**
 * Read `tenancy.yml` far enough to check it, and refuse to read it at all
 * rather than read it wrongly.
 *
 * There is no YAML parser in this repository and adding one needs manager
 * approval (PLAN.md §5), so this is a line reader for the six fields the
 * declaration actually uses. It is a deliberate choice and not an oversight:
 * the file is hand-maintained, its shape is asserted by this function, and a
 * reformat that breaks the reader goes red HERE rather than silently emptying
 * every set the assertions below compare against.
 */
type BlockName = "" | "scope" | "rls" | "entryPoints";
const BLOCKS: readonly string[] = ["scope", "rls", "entryPoints"];

function readDeclaration(): Declaration {
  const lines = readFileSync(DECLARATION, "utf8").split("\n");
  const found: Declaration = {
    accountScoped: null,
    entryPoints: [],
    scopeKey: null,
    sources: [],
    rlsSources: [],
    rlsDatabaseEnforced: null,
    nonRowSites: [],
  };

  // Top-level blocks, by column-0 indentation. Comments and blank lines are
  // skipped; a `#` at column 0 is how this file is documented.
  let block: BlockName = "";
  let inner: "" | "sources" | "nonRowSites" = "";
  let pending: { file?: string; line?: number } | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "" || line.startsWith("#")) continue;
    if (!raw.startsWith(" ") && !raw.startsWith("\t")) {
      const name = line.replace(/:.*$/, "");
      block = BLOCKS.includes(name) ? (name as BlockName) : "";
      inner = "";
      pending = null;
      continue;
    }
    if (block === "entryPoints") {
      // Only the SHAPE is needed here — the checker owns the contents, and a
      // honest zero declares an empty list.
      if (/^\s*-\s*\S/.test(line)) found.entryPoints.push(line);
      continue;
    }
    if (block !== "scope" && block !== "rls") continue;

    if (/^\s*sources:\s*$/.test(line)) {
      inner = "sources";
      pending = null;
      continue;
    }
    if (/^\s*nonRowSites:\s*$/.test(line)) {
      inner = "nonRowSites";
      pending = null;
      continue;
    }
    if (/^\s*(key|databaseEnforced):/.test(line)) {
      const value = line.replace(/^\s*\w+:\s*/, "").trim();
      if (line.includes("key:")) found.scopeKey = value;
      else found.rlsDatabaseEnforced = value === "true";
      inner = "";
      continue;
    }
    if (inner === "sources" && /^\s*-\s*\S/.test(line)) {
      const target = block === "scope" ? found.sources : found.rlsSources;
      target.push(line.replace(/^\s*-\s*/, "").trim());
      continue;
    }
    if (inner === "nonRowSites" && block === "scope") {
      const entry = /^\s*-\s*file:\s*(.+)$/.exec(line);
      if (entry) {
        pending = { file: entry[1].trim() };
        found.nonRowSites.push(pending as { file: string; line: number });
        continue;
      }
      const file = /^\s*file:\s*(.+)$/.exec(line);
      const lineNumber = /^\s*line:\s*(\d+)\s*$/.exec(line);
      if (file) {
        if (!pending) throw new Error("tenancy.yml: a nonRowSite line with no entry");
        pending.file = file[1].trim();
      }
      if (lineNumber) {
        if (!pending) throw new Error("tenancy.yml: a nonRowSite line with no entry");
        pending.line = Number(lineNumber[1]);
      }
    }
  }

  for (const site of found.nonRowSites) {
    if (typeof site.file !== "string" || typeof site.line !== "number") {
      throw new Error(`tenancy.yml: a nonRowSite is missing file or line — ${JSON.stringify(site)}`);
    }
  }
  if (found.accountScoped === null) {
    found.accountScoped = readScalar(lines, "accountScoped");
  }
  return found;
}

function readScalar(lines: string[], key: string): boolean | null {
  for (const line of lines) {
    const match = new RegExp(`^${key}:\\s*(true|false)\\s*$`).exec(line);
    if (match) return match[1] === "true";
  }
  return null;
}

// ---------------------------------------------------------------------------
// the tree, walked
// ---------------------------------------------------------------------------

function walk(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (SKIPPED.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

/** Repo-relative, POSIX-separated — the spelling a declaration uses. */
function repoPath(full: string): string {
  return relative(REPO, full).split(sep).join("/");
}

function isText(full: string): boolean {
  if (!TEXT_SUFFIXES.has(join(full).slice(full.lastIndexOf(".")))) return false;
  const head = readFileSync(full).subarray(0, 8000);
  return !head.includes(0);
}

/** Whether this line carries the key once its comment is removed — the same
 *  rule `tenancy_check.py`'s `carries_key` applies, so this suite counts what
 *  the checker counts. */
function carriesKey(line: string): boolean {
  const stripped = line.replace(/\/\/.*$/, "");
  return KEY_SPELLINGS.some((spelling) =>
    new RegExp(`(?<![A-Za-z0-9_])${spelling}(?![A-Za-z0-9_])`).test(stripped),
  );
}

// ---------------------------------------------------------------------------
// the ratchet
// ---------------------------------------------------------------------------

describe("tenancy.yml holds the honest zero shut", () => {
  const declaration = readDeclaration();

  it("declares the honest zero, in the shape the checker requires", () => {
    // `accountScoped: false` with an EMPTY enumeration is the only legal pair,
    // and the schema refuses the other three. This is the claim the whole file
    // makes, so it is asserted here rather than trusted to the checker.
    expect(declaration.accountScoped).toBe(false);
    expect(declaration.entryPoints).toEqual([]);
    expect(declaration.scopeKey).toBe(KEY);
    expect(declaration.rlsDatabaseEnforced).toBe(false);
  });

  it("names a source path that is really there", () => {
    const missing = [
      ...declaration.sources,
      ...declaration.rlsSources,
    ].filter((source) => {
      try {
        statSync(join(REPO, source));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it("covers every nameable file that carries the key", () => {
    // THE ratchet. A key-carrying file the schema can name, and that no
    // declared source reaches, is a file the checker walks past — the exact
    // shape of "darkroom has no routes" one directory down.
    const declared = new Set<string>();
    for (const source of declaration.sources) {
      const root = join(REPO, source);
      let entries: string[];
      try {
        if (statSync(root).isFile()) entries = [root];
        else entries = walk(root);
      } catch {
        continue;
      }
      for (const entry of entries) declared.add(repoPath(entry));
    }

    const all = [...walk(join(REPO, "src")), ...walk(join(REPO, "e2e"))];
    const unreached = all
      .filter((full) => isText(full))
      .map(repoPath)
      .filter((path) => NAMEABLE.test(path))
      .filter((path) => !declared.has(path));
    expect(unreached).toEqual([]);
  });

  it("leaves exactly one bracketed tree carrying the key, and it is the known one", () => {
    // The schema cannot name a bracketed path, so those files are outside the
    // scan by construction. This asserts the exception is EXACTLY what the
    // declaration's header says it is — no more files, and no fewer.
    const bracketed = [...walk(join(REPO, "src")), ...walk(join(REPO, "e2e"))]
      .filter((full) => isText(full))
      .filter((full) => !NAMEABLE.test(repoPath(full)))
      .filter((full) => {
        const text = readFileSync(full, "utf8");
        return KEY_SPELLINGS.some((spelling) =>
          text.includes(spelling),
        );
      })
      .map(repoPath);

    expect(bracketed).toEqual([
      "src/app/invitations/[token]/invitation-screen.test.tsx",
      "src/app/invitations/[token]/invitation-screen.tsx",
    ]);
  });

  it("vouches for every key-carrying site the scan reaches, and no others", () => {
    // Re-derived from the tree rather than copied from the declaration, so a
    // `nonRowSites` entry pointing at a line that moved is red here and not at
    // the next reader. Both directions: an unvouched site is
    // `tenancy.honest-zero`, a vouched site that no longer carries the key is a
    // declaration pointing at nothing.
    const declared = new Set<string>();
    for (const source of declaration.sources) {
      const root = join(REPO, source);
      try {
        if (statSync(root).isFile()) declared.add(repoPath(root));
        else for (const entry of walk(root)) declared.add(repoPath(entry));
      } catch {
        /* a missing declared source is the previous test's finding */
      }
    }

    const seen = new Set<string>();
    for (const path of [...declared].sort()) {
      const full = join(REPO, path);
      if (!isText(full)) continue;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (carriesKey(line)) seen.add(`${path}:${index + 1}`);
        });
    }

    const vouched = new Set(
      declaration.nonRowSites.map((site) => `${site.file}:${site.line}`),
    );
    expect([...seen].sort()).toEqual([...vouched].sort());
  });

  it("keeps the database half a zero: no DDL in the declared DDL sources", () => {
    // `rls.databaseEnforced: false` is a claim the checker tests by reading the
    // declared sources for the three DDL shapes it recognises: a policy
    // statement, an enable-or-force bit on a table, and kit's substrate call.
    // Same assertion, from this repository's own suite, so the day somebody
    // adds a migration the ratchet is here too.
    //
    // THIS FILE IS THE ONE EXCLUSION, and it is named rather than implied: the
    // three shapes are spelled as regex literals below, so the file carrying
    // the search would otherwise always match itself — a ratchet that is red
    // the moment it exists is a ratchet nobody reads. It is also why the prose
    // above does not spell them out.
    const SELF = "src/test/tenancy-declaration.test.ts";
    const shapes = [
      /\bcreate\s+policy\b/i,
      /\balter\s+table\b[^;]*\brow\s+level\s+security\b/i,
      /\bprotect_table\s*\(/i,
    ];
    const hits: string[] = [];
    for (const source of declaration.rlsSources) {
      const root = join(REPO, source);
      let files: string[];
      try {
        files = statSync(root).isFile() ? [root] : walk(root);
      } catch {
        continue;
      }
      for (const full of files) {
        if (!isText(full)) continue;
        const path = repoPath(full);
        if (path === SELF) continue;
        readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (shapes.some((shape) => shape.test(line))) {
              hits.push(`${path}:${index + 1}`);
            }
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
