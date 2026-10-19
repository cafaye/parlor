import { vi, type MockedFunction } from "vitest";

import {
  PantryError,
  type PantryClient,
  type Project,
  type ProjectEdge,
  type ProjectList,
  type ProjectRequiredBy,
  type ProjectRequirements,
  type ProjectVersion,
  type ProjectVersionList,
} from "@/lib/pantry";

/**
 * A scripted pantry client for the catalog screens' component tests.
 *
 * The real client is covered by `pantry.test.ts` against a transport stub.
 * This exists for the layer above it, and it matters more here than the other
 * providers' stubs do: the catalog and the project screens are reachable by a
 * STRANGER, so the anonymous path through a render test must have no way to
 * reach a socket either. Un-scripted methods reject loudly rather than quietly
 * returning `undefined`, because a screen that rendered an empty catalog
 * because its stub said nothing would be a green test guarding nothing.
 */
export type StubPantry = PantryClient & {
  listProjects: MockedFunction<PantryClient["listProjects"]>;
  getProject: MockedFunction<PantryClient["getProject"]>;
  getProjectByAddress: MockedFunction<PantryClient["getProjectByAddress"]>;
  listProjectVersions: MockedFunction<PantryClient["listProjectVersions"]>;
  getProjectCoordinates: MockedFunction<PantryClient["getProjectCoordinates"]>;
  projectRequirements: MockedFunction<PantryClient["projectRequirements"]>;
  projectRequiredBy: MockedFunction<PantryClient["projectRequiredBy"]>;
};

const unscripted = (method: string) =>
  vi.fn(() => Promise.reject(new Error(`stub pantry: ${method}() was not scripted`))) as never;

export function stubPantry(overrides: Partial<PantryClient> = {}): StubPantry {
  return {
    listProjects: vi.fn(overrides.listProjects ?? unscripted("listProjects")),
    getProject: vi.fn(overrides.getProject ?? unscripted("getProject")),
    getProjectByAddress: vi.fn(overrides.getProjectByAddress ?? unscripted("getProjectByAddress")),
    listProjectVersions: vi.fn(overrides.listProjectVersions ?? unscripted("listProjectVersions")),
    getProjectCoordinates: vi.fn(overrides.getProjectCoordinates ?? unscripted("getProjectCoordinates")),
    projectRequirements: vi.fn(overrides.projectRequirements ?? unscripted("projectRequirements")),
    projectRequiredBy: vi.fn(overrides.projectRequiredBy ?? unscripted("projectRequiredBy")),
  };
}

export function aPantryError(status: number, code = "internal"): PantryError {
  return new PantryError(`stub pantry failure (${status})`, { status, code });
}

/**
 * A tier-1 project fixture, in the shape pantry's catalog answers.
 *
 * `exposes` defaults to a real surface rather than to null, so a test
 * constructs the "no contract surface" case by saying so — the two are
 * different facts and a fixture that defaulted to null would teach the
 * screens the wrong one.
 */
export function aProject(overrides: Partial<Project> = {}): Project {
  return {
    name: "identity",
    description: "Authentication, sessions, MFA and tenancy.",
    language: "go",
    kind: "api",
    core: "^0.1.0",
    basePath: "/v1",
    exposes: { api: "openapi/v1.yaml", events: ["identity.user.created"] },
    consumes: [],
    dependencies: [],
    repository: { visibility: "public" },
    owner: { team: "identity", contact: "identity@cafaye.com" },
    owner_slug: "cafaye",
    ...overrides,
  };
}

/** A catalog page with one project on it and nothing after it. */
export function aProjectPage(project: Project = aProject()): ProjectList {
  return { data: [project], page: { next_cursor: null, has_more: false } };
}

export function aVersion(overrides: Partial<ProjectVersion> = {}): ProjectVersion {
  return {
    tag: "v0.2.0",
    version: "0.2.0",
    released_at: "2026-08-01T00:00:00Z",
    yanked: false,
    yank_reason: null,
    ...overrides,
  };
}

export function aVersionPage(versions: ProjectVersion[] = [aVersion()]): ProjectVersionList {
  return { data: versions, page: { next_cursor: null, has_more: false } };
}

/**
 * The forward graph answer, in the shape pantry's `/requirements` gives.
 *
 * `project` is the SUBJECT, echoing the path parameter, which is the client
 * checks — a fixture that echoed something else would be testing the client's
 * refusal rather than the screen. `data` defaults to ONE edge in each of the
 * three dependency words, so a test constructs the "leaf of the graph" case by
 * saying `{ data: [] }` rather than by getting a default it did not ask for.
 *
 * The double cast is the same idiom the client's own reader uses and for the
 * same reason: the brand is a REQUIRED phantom property, so a plain `as` is
 * refused precisely BECAUSE the brand is load-bearing.
 */
export function aRequirements(
  overrides: Partial<Omit<ProjectRequirements, "data"> & { data: ProjectEdge[] }> = {},
): ProjectRequirements {
  return {
    project: "identity",
    data: [
      { name: "core", version_range: "^0.1.0", dependency: "required" },
      { name: "muse", version_range: "~0.2.0", dependency: "soft" },
      { name: "box", version_range: ">=0.3.0", dependency: "dev" },
    ],
    ...overrides,
  } as unknown as ProjectRequirements;
}

/**
 * The backward graph answer, in the shape pantry's `/required-by` gives.
 *
 * A SEPARATE FIXTURE from `aRequirements` and not a parameter on it: the two
 * answers are two different types, and a helper that could produce both would
 * be a helper a caller could confuse the two with. The `name` defaults differ
 * too — `identifys` reverse edges are the projects that require identity.
 */
export function aRequiredBy(
  overrides: Partial<Omit<ProjectRequiredBy, "data"> & { data: ProjectEdge[] }> = {},
): ProjectRequiredBy {
  return {
    project: "identity",
    data: [
      { name: "courier", version_range: "^0.1.0", dependency: "required" },
      { name: "fleet", version_range: "~0.4.0", dependency: "required" },
    ],
    ...overrides,
  } as unknown as ProjectRequiredBy;
}
