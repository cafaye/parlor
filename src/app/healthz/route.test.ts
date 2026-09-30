import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /healthz", () => {
  it("returns 200", () => {
    expect(GET().status).toBe(200);
  });

  it("returns JSON with status ok", async () => {
    const body = await GET().json();

    expect(body).toEqual({ status: "ok" });
  });

  it("is not cached by intermediaries", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
