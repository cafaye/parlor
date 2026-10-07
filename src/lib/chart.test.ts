/**
 * The tests for parlor's Helm chart, and the red proofs that they can fail.
 *
 * WHY THIS FILE IS UNDER `src/lib/` AND NOT BESIDE `chart/`: vitest's
 * `include` glob only matches test files under `src/` (vitest.config.mts —
 * "if you add a test outside `src/`, it will not run, and `bin/prime` will
 * not notice").
 * The chart is this repository's deploy artifact, and a test that does not
 * run is not a test, so it lives here and reaches the chart by path.
 *
 * WHAT IS ASSERTED, and why each assertion is load-bearing:
 *
 * - The name/version seam (`parlor` / `0.1.0`). The substrate's Argo
 *   Application sources `chart: parlor` at `targetRevision: 0.1.0`; a chart
 *   whose Chart.yaml drifts from that is a chart Argo cannot find.
 * - `templates/application.yaml` is ABSENT. The substrate owns parlor's
 *   Application (kit's static one, OCI source); a second Application named
 *   `parlor` in `argocd` fights the first — same name, same namespace,
 *   different source. The generator no longer emits one (its README says
 *   so); this assertion is what keeps a future generator regression from
 *   silently landing one.
 * - The image tag is never `latest`. A floating tag is a deploy that
 *   changes when somebody else pushes; the pull-based loop exists so that
 *   what runs is exactly what the values commit said.
 * - The readiness path is `/readyz`, the fleet's contract, baked into the
 *   template rather than left as a value.
 * - The container port matches reality: the Dockerfile's `EXPOSE` and the
 *   port the server actually listens on (`ENV PORT=3000`, nitro's default).
 * - The templates are present and non-empty. A test that would pass
 *   against an empty `templates/` directory is not a test.
 *
 * The helm assertions run the real `helm template` against the committed
 * values — no `--set` for the green path — and the two red controls are
 * part of the suite: `ingress.enabled: false` emits no Ingress, and
 * enabled with an empty host FAILS the template. Both were shown red
 * before green (see the packet report).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// `process.cwd()` and not `import.meta.url`: under the jsdom environment
// `fileURLToPath(new URL("../../chart", import.meta.url))` throws —
// the same reason `openapi-document.test.ts` and `tokens.test.ts` use
// cwd. `npm test` and `bin/prime` both run vitest from the repository
// root, so cwd is the repo root.
const REPO = process.cwd();
const chartDir = resolve(REPO, "chart");

const chartYaml = readFileSync(`${chartDir}/Chart.yaml`, "utf8");
const valuesYaml = readFileSync(`${chartDir}/values.yaml`, "utf8");
const deploymentYaml = readFileSync(`${chartDir}/templates/deployment.yaml`, "utf8");
const serviceYaml = readFileSync(`${chartDir}/templates/service.yaml`, "utf8");
const ingressYaml = readFileSync(`${chartDir}/templates/ingress.yaml`, "utf8");
const dockerfile = readFileSync(resolve(REPO, "Dockerfile"), "utf8");

/** Run `helm template` against the chart; returns stdout, or throws on a non-zero exit. */
function helmTemplate(args: string[] = []): string {
  return execFileSync("helm", ["template", "parlor", chartDir, ...args], {
    encoding: "utf8",
  });
}

/** The first capture group of the first regex match, or null. */
function capture(pattern: RegExp, text: string): string | null {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

describe("chart content", () => {
  it("keeps the name/version seam the substrate's Application sources", () => {
    // kit/templates/substrate/manifests/applications/parlor.yaml sources
    // `chart: parlor` at `targetRevision: 0.1.0` — a drift here is a chart
    // Argo cannot find, and the deploy fails as "chart not found" rather
    // than as anything naming the real cause.
    expect(capture(/^name: (.+)$/m, chartYaml)).toBe("parlor");
    expect(capture(/^version: (.+)$/m, chartYaml)).toBe("0.1.0");
  });

  it("carries no templates/application.yaml — the substrate owns the Application", () => {
    // Two Applications named `parlor` in `argocd` fight each other: same
    // name, same namespace, different source. The generator no longer
    // emits one; this is the assertion that keeps a regression from
    // landing one silently.
    expect(existsSync(`${chartDir}/templates/application.yaml`)).toBe(false);
  });

  it("never floats the image tag on `latest`", () => {
    const tag = capture(/^  tag: "?([^"\s]+)"?$/m, valuesYaml);
    expect(tag).not.toBeNull();
    expect(tag).not.toBe("latest");
  });

  it("bakes the readiness path as /readyz, the fleet's contract", () => {
    // Not a value: a readiness path that can be edited is a readiness
    // path that can be pointed at `/up` — the defect the kamal template
    // had, which produced deploys that could never go green.
    expect(deploymentYaml).toContain("path: /readyz");
  });

  it("states a container port that matches the Dockerfile's EXPOSE", () => {
    // The generator takes the port from the language table
    // (`LanguagePort("typescript")` = 3000). The Dockerfile is the
    // authority on what the image actually serves: `ENV PORT=3000`,
    // `EXPOSE 3000`, and nitro listens on `PORT || 3000`. A disagreement
    // here is a finding, not something to paper over — so the two are
    // asserted equal rather than both assumed.
    const chartPort = capture(/containerPort: (\d+)/, deploymentYaml);
    const dockerfilePort = capture(/^EXPOSE (\d+)$/m, dockerfile);
    expect(dockerfilePort).not.toBeNull();
    expect(chartPort).toBe(dockerfilePort);
  });

  it("ships non-empty templates — a test that passes against an empty templates/ dir is not a test", () => {
    // Each assertion names the document the template must contain. An
    // empty (or emptied) templates/ directory fails all three.
    expect(deploymentYaml).toContain("kind: Deployment");
    expect(serviceYaml).toContain("kind: Service");
    expect(ingressYaml).toContain("kind: Ingress");
  });
});

describe("helm template against the committed values", () => {
  it("renders the Ingress parlor is reached through", () => {
    const rendered = helmTemplate();
    const ingress = rendered.slice(rendered.indexOf("kind: Ingress"));
    const document = ingress.slice(0, ingress.indexOf("---", 5));

    // The host the fleet's own fixtures name:
    // billing/test/fixtures/stripe/checkout.session.completed*.json
    // carries `https://app.cafaye.com/welcome`.
    expect(document).toContain("host: app.cafaye.com");
    expect(document).toContain("ingressClassName: traefik");
    expect(document).toContain(
      "cert-manager.io/cluster-issuer: letsencrypt-prod",
    );
    // `spec.tls` — without it there is no TLS: a secret nothing writes.
    expect(document).toContain("tls:");
    expect(document).toContain("secretName: parlor-tls");
  });

  it("RED CONTROL: ingress.enabled=false emits no Ingress at all", () => {
    // A chart that suddenly routes traffic is a defect: the substrate's
    // first sync happens before any operator has set a host.
    const rendered = helmTemplate(["--set", "ingress.enabled=false"]);
    expect(rendered).not.toContain("kind: Ingress");
  });

  it("RED CONTROL: enabled with an empty host fails the template", () => {
    // An Ingress with no host is a silent misroute — the class of defect
    // kit's /up healthcheck was. The template `fail`s rather than
    // rendering something that looks fine.
    expect(() => helmTemplate(["--set", "ingress.host="])).toThrow(
      /an Ingress with no host is a silent misroute/,
    );
  });
});
