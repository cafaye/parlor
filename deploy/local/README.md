# deploy/local — the local cluster, and the files that make it prod-shaped

This directory is the **local** half of the fleet's Kubernetes story. It is
committed in `parlor` because parlor is the repository the local-cluster
packet (`roll-k8s-chart`) was dispatched in, and the fleet has no separate
"cluster" repository: `kit` owns the substrate manifests and is a different
team's checkout this wave, so a copy of anything here would be a copy nobody
reviews.

The split this directory respects:

| what | where it lives | why |
|---|---|---|
| the service charts | each service repo (`parlor/chart`, `gateway/charts/gateway`, `pantry/chart`, …) | the chart is the deploy artifact, generated from the service's own manifest |
| the substrate's issuers | `kit/templates/substrate/manifests/tls/clusterissuer.yaml` | `letsencrypt-prod`/`letsencrypt-staging` are the ACME contract the charts *name* |
| **this directory** | here | the local cluster only: a self-signed CA, the `.test` host overrides, the CoreDNS rewrite |

**Nothing here runs in production.** Every file is a `.test`-host or
cluster-local thing. Production gets the substrate's `letsencrypt-prod` and
real DNS (PLAN-names-urls-rollout §3 L8).

## The two files that touch the cluster itself

- **`clusterissuer-anywaye-test.yaml`** — a self-signed CA ClusterIssuer named
  `anywaye-test-ca`. Local deployments point `ingress.clusterIssuer` at it.
  The issuer is created ONCE PER CLUSTER and the charts only NAME it, which
  is the same discipline the substrate's ACME issuers follow and the same
  one `imagePullSecrets` follows: the chart names the secret, it does not
  contain the credential.
- **`coredns-rewrite.yaml`** — the CoreDNS ConfigMap rewrite that makes
  `*.svc.anywaye.test` resolve **cluster-internally, and only there**.

## The values file

**`values.local.yaml`** holds the `.test` host overrides the local
deployment applies with `-f`. The charts' own `values.yaml` defaults are
untouched: the chart's default host (`app.anywaye.com` for parlor,
`api.anywaye.com` for gateway) stays the reference shape, per
PLAN-names-urls-rollout §1's URL map — `app.anywaye.com` is "the Parlor chart
default only; never a product face".

## Applying it, in order

```sh
kubectl apply -f deploy/local/clusterissuer-anywaye-test.yaml
kubectl apply -f deploy/local/coredns-rewrite.yaml      # then: -n kube-system rollout restart deployment coredns
helm upgrade --install gateway   <gateway-chart>  -n gateway   -f deploy/local/values.local.yaml
helm upgrade --install identity  <identity-chart> -n identity  -f deploy/local/values.local.yaml
helm upgrade --install parlor    chart          -n parlor    -f deploy/local/values.local.yaml
```

`bin/local-cluster` walks the same steps and is the thing to run when the
cluster is fresh.
