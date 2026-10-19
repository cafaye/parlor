/**
 * Typed client for pantry, the project catalog.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CLIENT IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * pantry is the public catalog of every project built with cafaye — the
 * fleet's own first, community projects beside them. This file speaks the
 * SEVEN READ OPERATIONS its contract declares and nothing else:
 *
 *   GET /v1/projects                         200 {data, page} | 400 | 503
 *   GET /v1/projects/{name}                  200 Project       | 404 | 503
 *   GET /v1/projects/{owner}/{name}          200 Project       | 404 | 503
 *   GET /v1/projects/{name}/versions         200 {data, page}  | 400 | 404 | 503
 *   GET /v1/projects/{name}/coordinates      200 {name, repository} | 401 | 403 | 404 | 503
 *   GET /v1/projects/{name}/requirements     200 ProjectRequirements | 404 | 503
 *   GET /v1/projects/{name}/required-by       200 ProjectRequiredBy   | 404 | 503
 *
 * The versions list is the public read of a project's published states —
 * tags verbatim, yank state visible — tier 1 since pantry's 1.5.0, so an
 * anonymous caller resolving a range can read it. The address route is how an
 * `<owner>/<name>` address is fetched as written. The write surface (publish,
 * edit, yank) is the same story it always was: it is not in this packet, and
 * a client method for it would be a method no caller in this repository may
 * use.
 *
 * ---------------------------------------------------------------------------
 * THE TIER LINE, WHICH IS THE WHOLE OF pantry's SHAPE
 * ---------------------------------------------------------------------------
 * Tier 1 is EXISTENCE AND DESCRIPTION — name, what it does, language, kind,
 * the core constraint, what it publishes and consumes, what it depends on,
 * whether its repository is public, and who is accountable for it. It is
 * free, it is public, and this client asks for it with no credential at all.
 *
 * Tier 2 is COORDINATES — `repository.url` and `defaultBranch`, where the
 * code lives. It is authenticated, it is the only thing in the document a
 * caller must be entitled to read, and it is refused before a single row is
 * read for an anonymous caller. `getProjectCoordinates` therefore REQUIRES a
 * token and throws before the wire without one, the same discipline
 * `src/lib/box.ts` holds on every one of its calls.
 *
 * THE LINE IS HELD ON THE READ SIDE TOO, and that is what
 * `readProject` is for. `repository` is read as one field — `visibility` —
 * and a tier-1 answer that arrives carrying a `url` produces a row with
 * none, because the only keys copied out of the response are the ones named
 * in this file. A reader that copied unknown keys would be a reader that
 * could be taught to.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROPERTIES EVERY CALL SHARES
 * ---------------------------------------------------------------------------
 * 1. EVERY CALL TAKES THE CALLER'S SESSION TOKEN, and the public reads take
 *    it optionally. When it is offered it is forwarded as the caller's own
 *    bearer — this app mints, stores and defaults no credential of its own,
 *    and a token-requiring call without one throws BEFORE the wire rather
 *    than being answered a 401 this client could have predicted.
 * 2. Failures are `PantryError`, a separate type from `IdentityError`,
 *    `BillingError` and `BoxError`. pantry is a different service with
 *    its own codes; a change to identity's envelope is not a change to this.
 *    `detail` is carried on the error and NEVER rendered: it is
 *    occurrence-specific and a screen writes its own sentence.
 * 3. The base URL is this app's OWN ORIGIN. Every call goes through the
 *    `/v1` BFF allow-list in `src/lib/upstream.ts`, so `PANTRY_URL` is a
 *    server-only variable and is not in this bundle.
 */

/** A project's kind, from pantry's own vocabulary. A fifth value is a contract change. */
export const PROJECT_KINDS = ["api", "worker", "both", "cli"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/**
 * A project's implementation language: core's manifest `language` enum minus
 * `spec`, which is the one value that cannot be a catalog entry — a
 * specification repository is not a project.
 *
 * A closed set, transcribed from pantry's document. pantry answers 400 for a
 * value outside it (and `spec` is one of those, deliberately), so a filter
 * this client refused here would be a round trip spent learning what the
 * document says. If pantry adds a language, this list is the bug and the file
 * is where it is fixed.
 */
export const PROJECT_LANGUAGES = ["go", "ruby", "elixir", "python", "typescript", "rust"] as const;
export type ProjectLanguage = (typeof PROJECT_LANGUAGES)[number];

/**
 * The grammar core's version constraint has, and nothing else.
 *
 * Four forms: a bare `MAJOR.MINOR.PATCH`, and the three comparators `^`, `~`
 * and `>=`. pantry checks the same pattern and answers 400 for anything
 * else, so the filter is checked here first — the client is the cheapest
 * place to learn that `>= 0.1.0` (with its space) is not a range.
 */
export const PROJECT_CONTRACT_PATTERN = /^(\^|~|>=)?[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * pantry's own grammar for a name on the wire — a project name, an owner
 * slug, and the `{name}`/`{owner}` path segments alike: lower case, digits,
 * and single hyphens between runs. One pattern rather than three spellings,
 * so the client, the filter and the address read cannot disagree about what
 * a slug is.
 */
export const PANTRY_SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** How visible a project's repository is. Absent from the wire reads as null. */
export const PROJECT_VISIBILITIES = ["public", "private"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/**
 * How hard one edge of the compatibility graph binds, in pantry's own three
 * words. A fourth value is a contract change.
 *
 * `required` — the project does not start without the other end. `soft` — it
 * starts and runs degraded, which is muse's own `required: false` written as a
 * word. `dev` — build and test time only. This is the WHOLE vocabulary, so an
 * edge carrying a fourth word is an edge this app has no branch for, and
 * `readEdge` below refuses it rather than rendering something it cannot
 * translate.
 */
export const PROJECT_DEPENDENCY_KINDS = ["required", "soft", "dev"] as const;
export type ProjectDependencyKind = (typeof PROJECT_DEPENDENCY_KINDS)[number];

/**
 * ONE END OF THE COMPATIBILITY GRAPH: the project at the other end, the
 * publisher's own constraint on that project's contract version, and how hard
 * the edge binds.
 *
 * `version_range` is carried VERBATIM. pantry stores what the publisher wrote
 * and its document is explicit that re-rendering it into an equivalent form
 * would be the registry quietly editing somebody's claim, so this client does
 * not parse it, normalise it, or compare it. It is a string that is displayed.
 */
export type ProjectEdge = {
  name: string;
  version_range: string;
  dependency: ProjectDependencyKind;
};

/*
 * ---------------------------------------------------------------------------
 * THE TWO QUESTIONS, AND WHY THEY ARE TYPES RATHER THAN PARAMETERS
 * ---------------------------------------------------------------------------
 * The forward direction asks what running one project needs. The backward
 * direction asks what breaks if it changes. An operator about to change a
 * contract reads the second one; an operator choosing what to run reads the
 * first. Both answers carry the same edge objects and nothing on the wire
 * distinguishes a forward answer from a backward one — both are
 * `{project, data}`.
 *
 * pantry declares them as two DIFFERENT objects anyway and its document says
 * why: "a client that confuses the two questions gets a type error rather
 * than an outage". That sentence is this brand. In a structurally-typed
 * language the only thing that survives a refactor is the type, so each
 * reader stamps its own marker and neither type is assignable to the other.
 * Reading the two answers into one shared type would be the outage: a screen
 * rendered from it would eventually show "Required by" over a requirements
 * list, and no test that compared shapes would notice, because the shapes
 * would be right.
 *
 * The brand is a phantom — it exists only in the type position, is never read
 * at run time, and is never on the wire.
 */
declare const requirementsBrand: unique symbol;
declare const requiredByBrand: unique symbol;

/**
 * The forward answer: what running `project` needs, in the projects it
 * declares a `requires` edge to.
 */
export type ProjectRequirements = {
  /** The subject, echoing the path parameter rather than leaving the caller to remember it. */
  project: string;
  /** The `requires` edges, ordered by the required project's name. Empty when the project is a leaf. */
  data: ProjectEdge[];
} & { readonly [requirementsBrand]: "requirements" };

/**
 * The backward answer: what depends on `project`, in the projects that
 * declare a `requires` edge TO it.
 */
export type ProjectRequiredBy = {
  /** The subject, echoing the path parameter. */
  project: string;
  /** The edges pointing at the subject, ordered by the requiring project's name. Empty when nothing requires it. */
  data: ProjectEdge[];
} & { readonly [requiredByBrand]: "required-by" };

/**
 * The paging envelope core's collections answer in.
 *
 * `next_cursor` is opaque — "clients must not parse it; its encoding may
 * change without notice" — so it is carried as a string and passed back
 * verbatim. `has_more` is the flag to branch on; a non-null cursor is NOT a
 * substitute, because a service is free to send a cursor it will not honour.
 */
export type ProjectPage = {
  next_cursor: string | null;
  has_more: boolean;
};

export type ProjectList = {
  data: Project[];
  page: ProjectPage;
};

/**
 * One published version of a project: the tag verbatim, its parsed triple,
 * when the publisher said it was released, and its yank state.
 *
 * `tag` is exactly what the publisher recorded, leading `v` included.
 * `version` is that tag parsed into `MAJOR.MINOR.PATCH`, and null when the
 * tag was not semver — a version with no parsed triple cannot satisfy a
 * compatibility range, and a caller resolving one has to be able to see that.
 * `yank_reason` is present iff `yanked` — absent, not null, on every version
 * that is not yanked — so it is read as null when absent rather than refused.
 */
export type ProjectVersion = {
  tag: string;
  version: string | null;
  released_at: string | null;
  yanked: boolean;
  yank_reason: string | null;
};

export type ProjectVersionList = {
  data: ProjectVersion[];
  page: ProjectPage;
};

/**
 * What a project publishes, or null when it declares no contract surface.
 *
 * `api` is a repository-relative path to the project's OpenAPI document, and
 * it is null when the project publishes none. `events` is the event types it
 * publishes, as `<project>.<entity>.<action>`.
 */
export type ProjectExposes = {
  api: string | null;
  events: string[];
};

/** One edge to another project this one builds on. */
export type ProjectDependency = {
  name: string;
  /** Constraint on the dependency's own contract version. Optional on the wire. */
  version: string | null;
  /** `false` is a soft dependency: the project runs degraded without it. Optional on the wire. */
  required: boolean | null;
};

/**
 * All tier 1 says about a project's repository: whether it is public.
 *
 * THE FIELD THIS TYPE DOES NOT HAVE IS THE POINT. `url` and `defaultBranch`
 * are the coordinates; they are tier 2's, served by
 * `getProjectCoordinates` to an entitled caller, and they are not in this
 * object for anyone else. `visibility` is not gated and stays here, because
 * whether a repository is public is itself an advertising fact — it is what
 * lets a caller tell a public project from a private one BEFORE they ask for
 * coordinates they may not get.
 */
export type ProjectRepository = {
  visibility: ProjectVisibility | null;
};

/** The accountable team, and where to reach them. */
export type ProjectOwner = {
  team: string | null;
  contact: string | null;
};

/**
 * One project: its manifest, plus `kind` and `basePath`.
 *
 * Optional keys are omitted rather than null when the manifest omits them;
 * this type normalises them to null so a screen has one reading of an
 * absence. `basePath` is null when the project publishes no OpenAPI
 * document, and `exposes` is null when it declares no contract surface —
 * both are facts rather than absences, which is why neither is optional.
 */
export type Project = {
  name: string;
  description: string | null;
  language: ProjectLanguage;
  kind: ProjectKind;
  /** The project's constraint on the core spec version, in core's four-form grammar. */
  core: string;
  /** The `/vN` prefix the project's contract paths are under, or null. */
  basePath: string | null;
  exposes: ProjectExposes | null;
  /** Event types this project subscribes to. Empty rather than absent. */
  consumes: string[];
  dependencies: ProjectDependency[];
  repository: ProjectRepository;
  owner: ProjectOwner;
  /**
   * The derived namespace of the project's address: `cafaye` for first-party
   * rows, the publisher's immutable owner slug otherwise. REQUIRED since
   * pantry's 1.7.0 — every tier-1 answer carries it, and the project's
   * address is `<owner_slug>/<name>`. It is NOT the manifest's `owner`
   * object beside it: one is where the project is addressed from, the other
   * is who is accountable for it.
   */
  owner_slug: string;
};

/**
 * TIER 2. Where a project's code lives, and the only thing a caller must be
 * entitled to read.
 *
 * Deliberately narrower than `Project`: it is two fields, because the
 * tier-2 question is "how do I fetch this" and everything a caller needs to
 * decide WHETHER to fetch it is already free on tier 1. A wider tier-2
 * object would be a second copy of tier 1 that nobody reads.
 */
export type ProjectCoordinates = {
  name: string;
  repository: {
    /** SSH remote. core's schema rejects HTTPS for a cafaye repository. */
    url: string;
    /** `master`, which is the only value core's schema allows. */
    defaultBranch: string | null;
  };
};

/** The filters the catalog read accepts. Anything else is dropped, not forwarded. */
export type ProjectFilter = {
  kind?: ProjectKind;
  language?: ProjectLanguage;
  /** A core version range to intersect against, in core's four-form grammar. */
  contract?: string;
  /**
   * Narrow to projects under one owner slug: `cafaye` for the fleet's own
   * rows, a publisher's immutable slug for community ones. Optional, in the
   * slug grammar like every other name on the wire.
   */
  owner?: string;
  /** Page size. 1–100, and the service defaults it to 25. */
  limit?: number;
  /** The opaque cursor from a previous answer's `page.next_cursor`. */
  cursor?: string;
};

/**
 * The filters the versions-list read accepts: the `contract` range-membership
 * test and the paging pair. The same four-form grammar and the same 1–100
 * page the catalog read holds, because pantry answers the same 400s here.
 */
export type ProjectVersionFilter = {
  /** Narrow to versions whose own triple falls inside this range. */
  contract?: string;
  /** Page size. 1–100, and the service defaults it to 25. */
  limit?: number;
  /** The opaque cursor from a previous answer's `page.next_cursor`. */
  cursor?: string;
};

export type PantryTransportRequest = {
  url: string;
  method: "GET";
  headers: Record<string, string>;
};

export type PantryTransport = (request: PantryTransportRequest) => Promise<Response>;

/**
 * Property declarations holding function types, for the reason `BillingClient`
 * and `BoxClient` spell their members that way: method shorthand
 * declares a `this` that does not exist, and
 * `@typescript-eslint/unbound-method` rejects the destructured read every
 * screen performs. `createPantryClient` below returns arrow functions
 * closing over `transport` and `base`, so there is no `this` to lose.
 */
export type PantryClient = {
  /**
   * The catalog, filtered and paged. PUBLIC: the caller's token is optional
   * and an anonymous visitor's read carries no credential at all.
   */
  listProjects: (token: string | null, filter?: ProjectFilter) => Promise<ProjectList>;
  /** One project, unwrapped. The same object the list wraps. */
  getProject: (token: string | null, name: string) => Promise<Project>;
  /**
   * One project by its full address — `cafaye/identity` for the fleet's own
   * rows, `<owner-slug>/<name>` for community ones. The same object
   * `getProject` returns, addressed as written rather than by bare name.
   * PUBLIC, like the bare-name read: the caller's token goes out when there
   * is one and nothing goes out when there is not.
   */
  getProjectByAddress: (token: string | null, owner: string, name: string) => Promise<Project>;
  /**
   * The public read of a project's versions: every published state, newest
   * first, keyed on the publisher's real git tags verbatim with yank state
   * visible. Tier 1 — an anonymous caller resolving a range reads it with no
   * credential at all, the same as the catalog read. A known project with no
   * versions is a 200 with `"data": []`, which is an answer and not a failure.
   */
  listProjectVersions: (
    token: string | null,
    name: string,
    filter?: ProjectVersionFilter,
  ) => Promise<ProjectVersionList>;
  /**
   * TIER 2: where a project's code lives. The token is REQUIRED — an empty
   * one throws before the wire, because pantry would answer 401 for it and
   * a client that learns its own credential rule from a round trip is a
   * client with a slower failure mode.
   */
  getProjectCoordinates: (token: string, name: string) => Promise<ProjectCoordinates>;
  /**
   * The FORWARD direction of the compatibility graph: what running this
   * project needs. PUBLIC — an anonymous visitor's read carries no credential
   * at all, the same as the catalog read.
   */
  projectRequirements: (token: string | null, name: string) => Promise<ProjectRequirements>;
  /**
   * The BACKWARD direction: what depends on this project. PUBLIC, and the
   * upgrade-safety question — read it before changing a contract.
   *
   * A DIFFERENT RETURN TYPE from `projectRequirements` on purpose; see the
   * brand note above.
   */
  projectRequiredBy: (token: string | null, name: string) => Promise<ProjectRequiredBy>;
};

/**
 * The `code` on a `PantryError` that means "this deployment has no pantry
 * configured", as distinct from "pantry answered that it is unavailable".
 *
 * The forwarder (`src/lib/upstream.ts`) answers a pantry route with a 503
 * carrying this code when `PANTRY_URL` is unset. It lives here rather than in
 * the forwarder because the forwarder is server-only and the screens that
 * branch on it are client code — the same place `BOX_NOT_CONFIGURED_CODE`
 * lives, and for the same reason.
 */
export const PANTRY_NOT_CONFIGURED_CODE = "pantry_not_configured";

export class PantryError extends Error {
  readonly status: number;
  /** The service's own code, or `internal`. */
  readonly code: string;
  readonly title: string | null;
  readonly traceId: string | null;

  constructor(
    message: string,
    options: { status: number; code?: string; title?: string | null; traceId?: string | null },
  ) {
    super(message);
    this.name = "PantryError";
    this.status = options.status;
    this.code = options.code ?? "internal";
    this.title = options.title ?? null;
    this.traceId = options.traceId ?? null;
  }
}

/** The origin every call in this file is made against: this app, same-origin. */
export const PANTRY_BASE_URL = "";

/**
 * The browser transport.
 *
 * `credentials: "same-origin"` for the same posture the other three clients
 * state: the cookies are the point of the BFF, and a caller's session rides
 * along on reads that need it. pantry authenticates nothing by cookie — its
 * tier-2 gate asks identity about a `caf` token — so this sends nothing a
 * screen did not hand it.
 */
const fetchTransport: PantryTransport = async ({ url, method, headers }) =>
  fetch(url, { method, headers, credentials: "same-origin" });

export function createPantryClient(
  options: { baseUrl?: string; transport?: PantryTransport } = {},
): PantryClient {
  const base = (options.baseUrl ?? PANTRY_BASE_URL).replace(/\/+$/, "");
  const transport = options.transport ?? fetchTransport;

  return {
    listProjects: (token, filter = {}) => {
      const query = projectQuery(filter);
      return send<{ data: unknown; page: unknown }>(
        transport,
        `${base}/v1/projects${query}`,
        token,
      ).then(readProjectList);
    },
    getProject: (token, name) => {
      const slug = requireName(name);
      return send<unknown>(transport, `${base}/v1/projects/${encodeURIComponent(slug)}`, token).then(
        (body) => readProject(body, "getProject"),
      );
    },
    getProjectByAddress: (token, owner, name) => {
      const ownerSlug = requireOwner(owner);
      const slug = requireName(name);
      return send<unknown>(
        transport,
        `${base}/v1/projects/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(slug)}`,
        token,
      ).then((body) => readProject(body, "getProjectByAddress"));
    },
    listProjectVersions: (token, name, filter = {}) => {
      const slug = requireName(name);
      const query = versionQuery(filter);
      return send<{ data: unknown; page: unknown }>(
        transport,
        `${base}/v1/projects/${encodeURIComponent(slug)}/versions${query}`,
        token,
      ).then((body) => readProjectVersionList(body));
    },
    getProjectCoordinates: (token, name) => {
      // TIER 2 REQUIRES THE CREDENTIAL, and the check is here rather than at
      // pantry: an empty token is a fact this client already holds, and
      // sending it anyway buys a 401 that tells the caller nothing new.
      requireToken(token);
      const slug = requireName(name);
      return send<unknown>(transport, `${base}/v1/projects/${slug}/coordinates`, token).then(
        (body) => readCoordinates(body),
      );
    },
    projectRequirements: (token, name) => {
      const slug = requireName(name);
      return send<unknown>(transport, `${base}/v1/projects/${slug}/requirements`, token).then(
        (body) => readGraphAnswer(body, slug, "projectRequirements") as ProjectRequirements,
      );
    },
    projectRequiredBy: (token, name) => {
      const slug = requireName(name);
      return send<unknown>(transport, `${base}/v1/projects/${slug}/required-by`, token).then(
        (body) => readGraphAnswer(body, slug, "projectRequiredBy") as ProjectRequiredBy,
      );
    },
  };
}

/**
 * The query string, filtered to the parameters the document declares.
 *
 * Nothing is sent empty: an absent filter is omitted rather than sent as
 * `?kind=`, which pantry answers with a 400 on purpose ("not the same as not
 * asking for the filter"). The values are checked HERE against the same
 * vocabulary pantry checks them against, so a screen cannot make a round trip
 * to be told what it already knew.
 */
function projectQuery(filter: ProjectFilter): string {
  if (filter.kind !== undefined && !PROJECT_KINDS.includes(filter.kind)) {
    throw new Error(
      `pantry's catalog knows no kind "${filter.kind}": the known kinds are ${PROJECT_KINDS.join(", ")}`,
    );
  }
  if (filter.language !== undefined && !PROJECT_LANGUAGES.includes(filter.language)) {
    throw new Error(
      `pantry's catalog knows no language "${filter.language}": the known languages are ${PROJECT_LANGUAGES.join(", ")}`,
    );
  }
  if (filter.contract !== undefined && !PROJECT_CONTRACT_PATTERN.test(filter.contract)) {
    throw new Error(
      `"${filter.contract}" is not a core constraint: MAJOR.MINOR.PATCH, or ^, ~ or >= in front of one`,
    );
  }
  if (filter.owner !== undefined && !PANTRY_SLUG_PATTERN.test(filter.owner.trim())) {
    throw new Error(
      `pantry's owner slugs are slugs (lower case, digits, hyphens): got "${filter.owner}"`,
    );
  }
  if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 100)) {
    throw new Error("pantry's page limit is an integer from 1 to 100");
  }
  if (filter.cursor !== undefined && filter.cursor.trim() === "") {
    throw new Error("pantry's cursor is the opaque value a previous answer returned");
  }

  const params = new URLSearchParams();
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.language) params.set("language", filter.language);
  if (filter.contract) params.set("contract", filter.contract);
  if (filter.owner) params.set("owner", filter.owner);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.cursor) params.set("cursor", filter.cursor);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * The query string for the versions-list read: the `contract`
 * range-membership test and the paging pair. The same 400s pantry answers on
 * the catalog read apply here, so the same pre-wire refusals do.
 */
function versionQuery(filter: ProjectVersionFilter): string {
  if (filter.contract !== undefined && !PROJECT_CONTRACT_PATTERN.test(filter.contract)) {
    throw new Error(
      `"${filter.contract}" is not a core constraint: MAJOR.MINOR.PATCH, or ^, ~ or >= in front of one`,
    );
  }
  if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 100)) {
    throw new Error("pantry's page limit is an integer from 1 to 100");
  }
  if (filter.cursor !== undefined && filter.cursor.trim() === "") {
    throw new Error("pantry's cursor is the opaque value a previous answer returned");
  }

  const params = new URLSearchParams();
  if (filter.contract) params.set("contract", filter.contract);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.cursor) params.set("cursor", filter.cursor);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

async function send<T>(
  transport: PantryTransport,
  url: string,
  token: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
  };
  // ANONYMOUS READS CARRY NO CREDENTIAL AT ALL, not an empty bearer. pantry's
  // tier 1 is public and its tier 2 gate is not confused by a malformed
  // header; the honest request is the one with nothing in it.
  if (token !== null && token.trim() !== "") headers.Authorization = `Bearer ${token}`;

  const response = await transport({ url, method: "GET", headers });
  if (!response.ok) throw await parseError(response);
  return (await readJson(response, url)) as T;
}

async function readJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    throw new PantryError(`pantry returned an empty body for ${url} (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PantryError(`pantry returned a body that is not JSON (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
}

/**
 * Turns a failure response into a `PantryError`.
 *
 * The envelope is core's RFC 9457 problem+json: `code` is the reserved word a
 * screen branches on and `trace_id` is the one identifier shared across the
 * hop. `detail` is read onto the message for a log and never rendered — it is
 * occurrence-specific, and the reason a screen writes its own sentence is
 * that a problem document's detail names a host, a role or a query fragment
 * more often than it names anything a person can act on.
 */
async function parseError(response: Response): Promise<PantryError> {
  const { status } = response;
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    // A body that cannot even be read is still a failure we can describe.
  }
  const body = asRecord(safeParse(raw));
  const traceId = readString(body?.trace_id) ?? response.headers.get("X-Trace-Id");
  if (body) {
    const code = readString(body.code) ?? "internal";
    const title = readString(body.title) ?? null;
    const detail = readString(body.detail);
    return new PantryError(detail ?? title ?? `Request to pantry failed (${status})`, {
      status,
      code,
      title,
      traceId,
    });
  }
  return new PantryError(`Request to pantry failed (${status})`, { status, traceId });
}

function readProjectList(body: { data: unknown; page: unknown }): ProjectList {
  const record = asRecord(body);
  if (record === null || !Array.isArray(record.data)) {
    throw new PantryError("pantry answered a catalog page this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return {
    data: record.data.map((entry) => readProject(entry, "listProjects")),
    page: readPage(record.page),
  };
}

function readProjectVersionList(body: { data: unknown; page: unknown }): ProjectVersionList {
  const record = asRecord(body);
  if (record === null || !Array.isArray(record.data)) {
    throw new PantryError("pantry answered a versions page this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return {
    data: record.data.map((entry) => readProjectVersion(entry)),
    page: readPage(record.page),
  };
}

/**
 * Reads one published version, field by field.
 *
 * The same tolerant discipline `readProject` holds rather than the strict
 * one `readEdge` does: the only keys copied out are the ones named here, so
 * a future additive field is dropped rather than refused, and a row this app
 * has no branch for is still unreadable — a non-string tag, a non-null
 * `version` outside the triple grammar, or a non-boolean `yanked` is refused
 * rather than rendered as the nearest thing.
 */
function readProjectVersion(entry: unknown): ProjectVersion {
  const record = asRecord(entry);
  const tag = record ? readString(record.tag) : null;
  if (record === null || tag === null) {
    throw new PantryError("pantry's listProjectVersions answered a version with no tag", {
      status: 200,
      code: "internal",
    });
  }
  const version = record.version;
  if (version !== null && version !== undefined && (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version))) {
    throw new PantryError(
      `pantry's listProjectVersions answered a version whose triple is outside MAJOR.MINOR.PATCH: "${tag}"`,
      { status: 200, code: "internal" },
    );
  }
  const yanked = record.yanked;
  if (typeof yanked !== "boolean") {
    throw new PantryError(
      `pantry's listProjectVersions answered a version with no yank state: "${tag}"`,
      { status: 200, code: "internal" },
    );
  }
  const yankReason = record.yank_reason;
  return {
    tag,
    version: typeof version === "string" && version.length > 0 ? version : null,
    released_at: readNullableString(record.released_at),
    yanked,
    // Present iff yanked — absent, not null, otherwise — so absent reads as
    // null. A non-string where a sentence belongs is refused: a yank whose
    // reason is not a sentence is a row this app cannot translate.
    yank_reason:
      yankReason === null || yankReason === undefined
        ? null
        : typeof yankReason === "string"
          ? yankReason
          : (() => {
              throw new PantryError(
                `pantry's listProjectVersions answered a yank reason this app does not recognise: "${tag}"`,
                { status: 200, code: "internal" },
              );
            })(),
  };
}

/**
 * Reads the paging envelope.
 *
 * `has_more` is read as a boolean and REFUSED when it is not one, because a
 * screen's "Next" control hangs off it and a string `"true"` would be a
 * control that is always on.
 */
function readPage(value: unknown): ProjectPage {
  const record = asRecord(value);
  const nextCursor = readNullableString(record?.next_cursor);
  const hasMore = record?.has_more;
  if (record === null || typeof hasMore !== "boolean") {
    throw new PantryError("pantry answered a page this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return { next_cursor: nextCursor, has_more: hasMore };
}

/**
 * Reads one project, field by field, and refuses what it cannot read.
 *
 * THAT IS THE WHOLE DISCIPLINE AND IT IS WORTH SAYING WHY IT IS THIS STRICT.
 * `kind` and `language` are closed vocabularies, so a row carrying a fourth
 * kind is a row this app has no branch for — and a screen with no branch has
 * exactly two bad options, render a word it cannot translate or fall through
 * to a generic sentence that reads as a fault. Both are worse than a failure
 * that names the field.
 *
 * `core` is read as a non-empty string and NOT pattern-checked: the row's
 * constraint is the publisher's to declare and pantry's to accept, and a
 * client that refused a row for a shape the document once described would be
 * a client that breaks the catalog on a service-side change. The FILTER is
 * checked, because that is this app's own outbound value.
 */
function readProject(entry: unknown, operation: string): Project {
  const record = asRecord(entry);
  const name = record ? readString(record.name) : null;
  const language = record?.language;
  const kind = record?.kind;
  if (record === null || name === null) {
    throw new PantryError(`pantry's ${operation} answered a project with no name`, {
      status: 200,
      code: "internal",
    });
  }
  if (!PROJECT_LANGUAGES.includes(language as ProjectLanguage)) {
    throw new PantryError(`pantry's ${operation} answered a project with an unknown language`, {
      status: 200,
      code: "internal",
    });
  }
  if (!PROJECT_KINDS.includes(kind as ProjectKind)) {
    throw new PantryError(`pantry's ${operation} answered a project with an unknown kind`, {
      status: 200,
      code: "internal",
    });
  }
  const core = readString(record.core);
  if (core === null) {
    throw new PantryError(`pantry's ${operation} answered a project with no core constraint`, {
      status: 200,
      code: "internal",
    });
  }
  const ownerSlug = readString(record.owner_slug);
  if (ownerSlug === null || !PANTRY_SLUG_PATTERN.test(ownerSlug)) {
    throw new PantryError(`pantry's ${operation} answered a project with no owner_slug`, {
      status: 200,
      code: "internal",
    });
  }
  return {
    name,
    description: readNullableString(record.description),
    language: language as ProjectLanguage,
    kind: kind as ProjectKind,
    core,
    basePath: readNullableString(record.basePath),
    exposes: readExposes(record.exposes, operation),
    consumes: readStringArray(record.consumes, operation, "consumes"),
    dependencies: readDependencies(record.dependencies, operation),
    repository: readRepository(record.repository),
    owner: readOwner(record.owner),
    owner_slug: ownerSlug,
  };
}

/**
 * Reads what a project publishes.
 *
 * A null is THE FACT that the manifest declares no contract surface, and it
 * is preserved rather than flattened to an empty object: "serves nothing" and
 * "serves nothing it has written a document for" are different facts and the
 * second one is not this app's to invent.
 */
function readExposes(value: unknown, operation: string): ProjectExposes | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (record === null) {
    throw new PantryError(`pantry's ${operation} answered an exposes this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return {
    api: readNullableString(record.api),
    events: readStringArray(record.events, operation, "exposes.events"),
  };
}

function readDependencies(value: unknown, operation: string): ProjectDependency[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PantryError(`pantry's ${operation} answered dependencies this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return value.map((entry) => {
    const record = asRecord(entry);
    const name = record ? readString(record.name) : null;
    if (name === null) {
      throw new PantryError(`pantry's ${operation} answered a dependency with no name`, {
        status: 200,
        code: "internal",
      });
    }
    const required = record?.required;
    return {
      name,
      version: readNullableString(record?.version),
      // Absent rather than false: `required` is optional on the wire and a
      // missing one is NOT the same statement as a soft dependency.
      required: typeof required === "boolean" ? required : null,
    };
  });
}

/**
 * Reads the ONE field tier 1 says about a repository.
 *
 * The reader names `visibility` and nothing else, so a tier-1 answer that
 * arrives with a `url` in it produces a row with none. That is the read side
 * of the tier line and it is the same discipline
 * `readEmailProviderConnection` in `src/lib/box.ts` holds for a sealed
 * credential: a reader that copied unknown keys would be a reader that could
 * be taught to.
 */
function readRepository(value: unknown): ProjectRepository {
  const record = asRecord(value);
  if (record === null) return { visibility: null };
  const visibility = record.visibility;
  return {
    visibility:
      typeof visibility === "string" && PROJECT_VISIBILITIES.includes(visibility as ProjectVisibility)
        ? (visibility as ProjectVisibility)
        : null,
  };
}

function readOwner(value: unknown): ProjectOwner {
  const record = asRecord(value);
  return {
    team: readNullableString(record?.team),
    contact: readNullableString(record?.contact),
  };
}

function readStringArray(value: unknown, operation: string, field: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PantryError(`pantry's ${operation} answered a ${field} this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Reads ONE edge, field by field, and refuses what it cannot read.
 *
 * `additionalProperties: false` is the document's own declaration, so a
 * fourth key is a contract change rather than a field to carry forward — the
 * same trade `readCoordinates` makes, and the cost is named rather than
 * hidden: the day pantry widens this object, this client fails loudly on a
 * screen instead of quietly dropping the new fact. That is the right
 * direction for a client whose screens are read by operators mid-change.
 *
 * `name` and `version_range` are the publisher's own claims and are read as
 * non-empty strings, NOT pattern-checked, for the reason `readProject` gives
 * about `core`: a client that refused an edge for a shape the document once
 * described would be a client that breaks the graph on a service-side change.
 * The outbound values ARE checked — `requireName` above — because those are
 * this app's own.
 */
function readEdge(value: unknown, operation: string): ProjectEdge {
  const record = asRecord(value);
  if (record === null) {
    throw new PantryError(`pantry's ${operation} answered an edge this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  for (const key of Object.keys(record)) {
    if (key !== "name" && key !== "version_range" && key !== "dependency") {
      throw new PantryError(
        `pantry's ${operation} answered an edge carrying a field this app did not ask for: ${key}`,
        { status: 200, code: "internal" },
      );
    }
  }
  const name = readString(record.name);
  if (name === null) {
    throw new PantryError(`pantry's ${operation} answered an edge with no name`, {
      status: 200,
      code: "internal",
    });
  }
  const versionRange = readString(record.version_range);
  if (versionRange === null) {
    throw new PantryError(`pantry's ${operation} answered an edge with no version_range`, {
      status: 200,
      code: "internal",
    });
  }
  const dependency = record.dependency;
  if (
    typeof dependency !== "string" ||
    !PROJECT_DEPENDENCY_KINDS.includes(dependency as ProjectDependencyKind)
  ) {
    throw new PantryError(
      `pantry's ${operation} answered an edge whose dependency is outside the three-word vocabulary`,
      { status: 200, code: "internal" },
    );
  }
  return { name, version_range: versionRange, dependency: dependency as ProjectDependencyKind };
}

/**
 * Reads a graph answer, in EITHER direction, and the two directions' callers
 * stamp their own brand on the result.
 *
 * THE ECHO IS CHECKED, and that is not pedantry. The wrapper carries the
 * subject "rather than leaving the caller to remember it", so an answer
 * naming a different project than the one asked for is either a router bug
 * upstream or a response swapped between the two directions — and a swapped
 * one would render somebody else's edges over this project's name. The
 * `project` slot makes that visible; a reader that ignored it would make it
 * invisible.
 */
function readGraphAnswer(
  value: unknown,
  subject: string,
  operation: string,
): { project: string; data: ProjectEdge[] } {
  const record = asRecord(value);
  if (record === null) {
    throw new PantryError(`pantry's ${operation} answered a graph this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  for (const key of Object.keys(record)) {
    if (key !== "project" && key !== "data") {
      throw new PantryError(
        `pantry's ${operation} answered a graph carrying more than the two fields it declares: ${key}`,
        { status: 200, code: "internal" },
      );
    }
  }
  const project = readString(record.project);
  if (project === null) {
    throw new PantryError(`pantry's ${operation} answered a graph with no project`, {
      status: 200,
      code: "internal",
    });
  }
  if (!Array.isArray(record.data)) {
    throw new PantryError(`pantry's ${operation} answered edges this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  if (project !== subject) {
    throw new PantryError(
      `pantry's ${operation} answered about "${project}" where "${subject}" was asked for`,
      { status: 200, code: "internal" },
    );
  }
  return {
    project,
    data: record.data.map((entry) => readEdge(entry, operation)),
  };
}

/**
 * Reads one tier-2 answer.
 *
 * Only the two named fields are copied, and a body carrying a third —
 * a manifest, an owner, the dependency graph — is REFUSED rather than read
 * for its two good keys. That is the point of a narrow tier-2 object: the
 * day pantry widens it, this client should fail loudly rather than quietly
 * hold coordinates beside something this app has no display contract for.
 */
function readCoordinates(value: unknown): ProjectCoordinates {
  const record = asRecord(value);
  const name = record ? readString(record.name) : null;
  const repository = asRecord(record?.repository);
  const url = repository ? readString(repository.url) : null;
  if (record === null || name === null || repository === null || url === null) {
    throw new PantryError("pantry answered coordinates this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  if (Object.keys(repository).some((key) => key !== "url" && key !== "defaultBranch")) {
    throw new PantryError("pantry answered coordinates carrying more than the repository line", {
      status: 200,
      code: "internal",
    });
  }
  if (Object.keys(record).some((key) => key !== "name" && key !== "repository")) {
    throw new PantryError("pantry answered coordinates carrying more than the two fields", {
      status: 200,
      code: "internal",
    });
  }
  return {
    name,
    repository: {
      url,
      defaultBranch: readNullableString(repository.defaultBranch),
    },
  };
}

/**
 * A project name, checked before it is spliced into a URL.
 *
 * pantry's own grammar for the path segment is a slug — lower case, digits,
 * and single hyphens between runs. The check is not about the value being
 * real (pantry answers 404 for a name nobody registered, which is the
 * service's to answer); it is about the value being ABLE to name a path.
 * `../`, an empty segment and an absolute URL are all refused here for the
 * same reason `src/lib/upstream.ts` value-matches its own wildcards: a
 * segment that cannot traverse is not a segment that has been filtered.
 */
function requireName(value: string): string {
  const name = value.trim();
  if (!PANTRY_SLUG_PATTERN.test(name)) {
    throw new Error(`pantry's project names are slugs (lower case, digits, hyphens): got "${value}"`);
  }
  return name;
}

/**
 * An owner slug, checked before it is spliced into a URL — the same grammar
 * as a project name, because pantry declares the same pattern on both path
 * segments. `cafaye` for the fleet's own rows, a publisher's immutable slug
 * for community ones.
 */
function requireOwner(value: string): string {
  const owner = value.trim();
  if (!PANTRY_SLUG_PATTERN.test(owner)) {
    throw new Error(`pantry's owner slugs are slugs (lower case, digits, hyphens): got "${value}"`);
  }
  return owner;
}

function requireToken(token: string | null): void {
  if (token === null || token.trim() === "") {
    throw new Error(
      "pantry's coordinates are tier 2: the call needs the caller's session token, and an empty one is refused before the wire",
    );
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length > 0 ? value : null;
}
