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
 *
 * The publish caller assertions read `.github/workflows/publish.yml` —
 * kit's caller template, copied verbatim — and assert the facts that make
 * the publish loop work: that it calls kit's composed publish workflow
 * (a caller that inlines the steps has forked the composition), that it
 * grants `packages: write` (a reusable workflow can request a permission
 * but cannot grant itself one), that it passes `push: true` (the reusable
 * workflows default to `push: false`, so a caller that omits it publishes
 * nothing and says nothing), and that the chart dir it names — `chart/`,
 * resolved from the `chart-dir` input with kit's default — holds a
 * `Chart.yaml` whose `version` is `0.1.0`, the OCI tag the substrate's
 * Application pulls. The four red controls are part of the suite: a
 * caller that inlines the steps, a caller with `push: false`, a caller
 * with no `packages: write` grant, and a chart whose version has drifted
 * from the tag. All four were shown red before green.
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

// kit/templates/publish/publish.yml, copied verbatim to
// .github/workflows/publish.yml — the whole of parlor's side of the publish
// loop is that one caller file.
const publishWorkflowPath = resolve(REPO, ".github/workflows/publish.yml");

// kit/templates/substrate/manifests/applications/parlor.yaml — the Argo CD
// Application the chart is pulled by. The chart's version IS the OCI tag
// (chart.reusable.yml reads name and version from Chart.yaml and never takes
// them as inputs), so this number and Chart.yaml's `version` are one fact
// written twice: a service that bumps one and not the other is a service
// that never deploys.
const TARGET_REVISION = "0.1.0";

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
    const tag = capture(/^ {2}tag: "?([^"\s]+)"?$/m, valuesYaml);
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

    // The hosts the fleet's own fixtures name plus the apex+www that serve
    // the marketing landing and the /box/install front door:
    // billing/test/fixtures/stripe/checkout.session.completed*.json
    // carries `https://app.cafaye.com/welcome`; cafaye.com and
    // www.cafaye.com carry the front door `curl | bash` lands on.
    expect(document).toContain("host: app.cafaye.com");
    expect(document).toContain("host: cafaye.com");
    expect(document).toContain("host: www.cafaye.com");
    expect(document).toContain("ingressClassName: traefik");
    expect(document).toContain(
      "cert-manager.io/cluster-issuer: letsencrypt-prod",
    );
    // `spec.tls` — one entry per host, one secret per host (Traefik pattern),
    // without it there is no TLS: a secret nothing writes.
    expect(document).toContain("tls:");
    expect(document).toContain("secretName: parlor-tls-app-cafaye-com");
    expect(document).toContain("secretName: parlor-tls-cafaye-com");
    expect(document).toContain("secretName: parlor-tls-www-cafaye-com");
    // Exactly three hosts and three TLS entries — a host dropped from the
    // list is a front door that 404s at Traefik with no matching route.
    expect((document.match(/secretName: parlor-tls-/g) ?? []).length).toBe(3);
    expect((document.match(/- host: /g) ?? []).length).toBe(3);
  });

  it("RED CONTROL: ingress.enabled=false emits no Ingress at all", () => {
    // A chart that suddenly routes traffic is a defect: the substrate's
    // first sync happens before any operator has set a host.
    const rendered = helmTemplate(["--set", "ingress.enabled=false"]);
    expect(rendered).not.toContain("kind: Ingress");
  });

  it("RED CONTROL: enabled with empty hosts (and empty legacy host) fails the template", () => {
    // An Ingress with no host is a silent misroute — the class of defect
    // kit's /up healthcheck was. The template `fail`s rather than
    // rendering something that looks fine. `hosts` is the new shape; `host`
    // is the deprecated singular that the template falls back to when
    // `hosts` is empty, so both must be empty to trigger the guard.
    expect(() =>
      helmTemplate(["--set-json", "ingress.hosts=[]", "--set", "ingress.host="]),
    ).toThrow(/an Ingress with no host is a silent misroute/);
  });

  it("legacy host still renders a single-host Ingress when hosts is empty", () => {
    // Back-compat: an existing values file with `host: app.cafaye.com` and no
    // `hosts` still renders. Proved able to fail: deleting the fallback
    // turns this green path into the silent-misroute failure above.
    const rendered = helmTemplate([
      "--set-json",
      "ingress.hosts=[]",
      "--set",
      "ingress.host=legacy.example.com",
    ]);
    const ingress = rendered.slice(rendered.indexOf("kind: Ingress"));
    const document = ingress.slice(0, ingress.indexOf("---", 5));
    expect(document).toContain("host: legacy.example.com");
    expect(document).toContain("secretName: parlor-tls-legacy-example-com");
  });
});

// --- the publish caller ----------------------------------------------------
//
// `.github/workflows/publish.yml` is kit's caller template copied verbatim.
// It is the whole of parlor's side of the publish loop: one `uses:` of kit's
// composed publish workflow, which publishes both the image
// `config/deploy.yml` deploys and the chart the Argo CD Application pulls.

/**
 * The chart dir the caller names, resolved the way the reusable workflow
 * resolves it: the `chart-dir:` input if the caller has one, else kit's
 * default `chart/`. Resolved rather than assumed because the caller is the
 * verbatim template and the template names no chart-dir — the default is
 * the fact.
 */
function chartDirNamedBy(workflowYaml: string): string {
  return capture(/^\s*chart-dir: (\S+)\s*$/m, workflowYaml) ?? "chart";
}

/**
 * The facts that make the publish loop work, asserted against the caller
 * workflow's text and the chart it names. PURE — it takes text, not paths —
 * because the red controls below feed it broken text and expect it to throw;
 * a check that cannot fail is worse than no test.
 */
function expectPublishLoop(
  workflowYaml: string,
  chartDir: string,
  chartYaml: string,
): void {
  // THE COMPOSITION LIVES IN KIT. A caller that inlines the steps has forked
  // it, and a fix in kit's publish.reusable.yml stops landing here.
  if (
    !workflowYaml.includes(
      "uses: cafaye/kit/.github/workflows/publish.reusable.yml@master",
    )
  ) {
    throw new Error(
      "the publish caller must call kit's composed publish workflow — `uses: cafaye/kit/.github/workflows/publish.reusable.yml@master` — and not inline the steps: the composition lives in kit, and a caller that inlines it has forked it, so a fix in kit stops landing here",
    );
  }
  // THE GRANT IS THE CALLER'S TO MAKE. A reusable workflow can request a
  // permission but cannot grant itself one; a caller that omits this gets a
  // 401 at the push that reads like a wrong password rather than a missing
  // grant.
  if (!/^\s*packages: write\s*$/m.test(workflowYaml)) {
    throw new Error(
      "the publish caller must grant `packages: write` — a reusable workflow can request a permission but cannot grant itself one, and omitting it is a 401 at the push that reads like a wrong password",
    );
  }
  // THE OPT-IN. The reusable workflows default to `push: false`, so a caller
  // that omits the input — or sets it false — publishes nothing and says
  // nothing.
  if (!/^\s*push: true\s*$/m.test(workflowYaml)) {
    throw new Error(
      "the publish caller must pass `push: true` — the reusable workflows default to `push: false`, so a caller that omits the input publishes nothing and says nothing",
    );
  }
  // THE TRIGGER. A publish workflow that does not run on push to master
  // publishes nothing on push to master.
  if (!/^\s*branches: \[master\]\s*$/m.test(workflowYaml)) {
    throw new Error(
      "the publish caller must trigger on push to master — `on: push: branches: [master]` — or a push to master publishes nothing",
    );
  }
  // THE VERSION SEAM, both sides named. The chart's version IS the tag the
  // substrate pulls; a service that bumps one and not the other is a service
  // that never deploys.
  const chartVersion = capture(/^version: (.+)$/m, chartYaml);
  if (chartVersion !== TARGET_REVISION) {
    throw new Error(
      `chart ${chartDir}/Chart.yaml version ${chartVersion ?? "(absent)"} is not the OCI tag the substrate pulls — targetRevision: ${TARGET_REVISION}. The chart's version IS the tag (chart.reusable.yml reads name and version from Chart.yaml and never takes them as inputs), and the two are the same fact written twice; a service that bumps one and not the other is a service that never deploys`,
    );
  }
}

describe("the publish caller", () => {
  it("calls kit's composed publish workflow, grants packages: write, passes push: true, and names a chart dir whose Chart.yaml version is the tag the substrate pulls", () => {
    // Read here rather than at module scope so a tree with no caller fails
    // THIS describe block, not the chart assertions above.
    const workflowYaml = readFileSync(publishWorkflowPath, "utf8");
    const chartDir = chartDirNamedBy(workflowYaml);
    const chartYaml = readFileSync(resolve(REPO, chartDir, "Chart.yaml"), "utf8");
    expectPublishLoop(workflowYaml, chartDir, chartYaml);
  });

  it("RED CONTROL: a caller that inlines the steps instead of calling the composed workflow goes red", () => {
    // "The caller removed" at the assertion half: the workflow text with the
    // call to kit's composed publish workflow deleted. The file-read half is
    // the green test's readFileSync throwing ENOENT — the same red.
    const workflowYaml = readFileSync(publishWorkflowPath, "utf8").replace(
      /^ {4}uses: cafaye\/kit\/\.github\/workflows\/publish\.reusable\.yml@master\n/m,
      "",
    );
    expect(() => expectPublishLoop(workflowYaml, "chart", chartYaml)).toThrow(
      /composed publish workflow/,
    );
  });

  it("RED CONTROL: a caller with push: false goes red", () => {
    // The reusable workflows default to `push: false`; a caller that sets it
    // false publishes nothing and says nothing.
    const workflowYaml = readFileSync(publishWorkflowPath, "utf8").replace(
      /^(\s*)push: true\s*$/m,
      "$1push: false",
    );
    expect(() => expectPublishLoop(workflowYaml, "chart", chartYaml)).toThrow(
      /push: true/,
    );
  });

  it("RED CONTROL: a caller with no packages: write grant goes red", () => {
    // A reusable workflow can request a permission but cannot grant itself
    // one; the grant omitted is a 401 at the push.
    const workflowYaml = readFileSync(publishWorkflowPath, "utf8").replace(
      /^\s*packages: write\s*$\n/m,
      "",
    );
    expect(() => expectPublishLoop(workflowYaml, "chart", chartYaml)).toThrow(
      /packages: write/,
    );
  });

  it("RED CONTROL: a chart whose version has drifted from the tag the substrate pulls goes red", () => {
    // Chart.yaml version 0.1.1 against the Application's targetRevision
    // 0.1.0: the push succeeds, the pull finds nothing, and Argo reports no
    // error. The failure message names both sides.
    const drifted = chartYaml.replace(/^version: .+$/m, "version: 0.1.1");
    expect(() =>
      expectPublishLoop(
        readFileSync(publishWorkflowPath, "utf8"),
        "chart",
        drifted,
      ),
    ).toThrow(/targetRevision: 0\.1\.0/);
  });
});
