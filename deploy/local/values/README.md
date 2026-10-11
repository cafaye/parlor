# The local `.test` values — one file per release

Each file is what `helm upgrade --install <release> <chart> -f <this file>`
applies. They are **separate files rather than one merged one** even though the
shared overrides are the same three things, because the charts do not share a
values schema:

| release | chart | where |
|---|---|---|
| `gateway` | `gateway/charts/gateway` | `values/gateway.yaml` |
| `identity` | `identity/chart` | `values/identity.yaml` |
| `parlor` | `parlor/chart` | `values/parlor.yaml` |
| `pantry` | `pantry/chart` | `values/pantry.yaml` |

The two chart SHAPES differ in more than the values, and this is the reason a
single merged file would be a trap rather than a convenience:

| | the generated charts (parlor, identity, pantry) | gateway's chart (written generated-shaped by hand, packet gateway-w67) |
|---|---|---|
| replica count | `replicas` | `replicaCount` |
| TLS | `ingress.tls: true` | `ingress.tls.enabled: true` / `ingress.tls.secretName` |
| extra annotations | none | `ingress.annotations` (an operator value wins over the issuer) |
| port values | `service.port` + the container port from the generator | `service.port` must agree with `env.PORT`, by hand |

A single file carrying both spellings happens to work — Helm values are an
additive map and an unrecognized key is inert — but "happens to work" is not a
convention, and the first person who adds a key that is *not* inert would not
be able to see it here.

## What every file overrides, and why

1. **`ingress.host`** → the `.test` name from PLAN-names-urls-rollout §1's URL
   map. **The chart's own default host is not edited.** parlor's stays
   `app.cafaye.com` ("the Parlor chart default only; never a product face"),
   gateway's stays `gateway.cafaye.com`. The default is the reference shape;
   the local deployment overrides it, which is what a values file is for.
2. **`ingress.clusterIssuer`** → `cafaye-test-ca`, and NOT the
   `letsencrypt-prod` the charts name. This is deliberate failure: on a local
   cluster there is no `letsencrypt-prod`, so a chart left pointing at it
   produces a Certificate that never issues. Overriding it here is what makes
   the local shape exercisable without touching a generated file.
3. **`image.pullPolicy`** → `Never` and `image.repository`/`tag` → the local
   build. The local images are imported into the cluster with `k3d image
   import`, so nothing is pulled from `ghcr.io` — and `IfNotPresent` with a
   tag the cluster already has is the same thing with one more lookup.

## What the files deliberately do NOT do

- **They do not carry a credential.** gateway's `secrets.*` are *names*; the
  secrets themselves are created out of band (`kubectl create secret`), which
  is the same discipline the charts follow.
- **They do not enable an Ingress a chart leaves off for a reason.** pantry's
  is off in its generated `values.yaml` because pantry stays internal, and this
  file leaves it off. Turning it on with a `.test` host is a one-line change
  for a browser-driven test, and it is written to be reversible.
- **They do not set `ingress.enabled: true` on a chart whose host is empty.**
  The generated templates `fail` on that combination, by design, and the local
  files always name a host.
