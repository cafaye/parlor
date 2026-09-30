import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /readyz", () => {
  it("returns 200", () => {
    expect(GET().status).toBe(200);
  });

  it("reports ok with no dependencies", async () => {
    const body = await GET().json();

    expect(body).toEqual({ status: "ok", deps: "none" });
  });

  it("reserves the deps key for Phase 2 dependency checks", async () => {
    const body = await GET().json();

    // Shape contract: `deps` is a placeholder string today. Once Phase 2 wires
    // real dependency checks it must become an array without breaking the shape.
    expect(Object.keys(body).sort()).toEqual(["deps", "status"]);
    expect(typeof body.deps).toBe("string");
  });

  it("is not cached by intermediaries", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
