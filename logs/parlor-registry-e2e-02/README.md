# Raw logs — parlor-registry-e2e-02

The full tier, `./bin/e2e`, against registry images, on a worktree that had
never run it. Nothing here is edited; read it before the summary.

| file | what it is |
|---|---|
| `01-npm-ci.log` | priming. `timeout 900 npm ci`. exit 0. |
| `02-playwright-install.log` | priming. `timeout 900 npx playwright install chromium`. exit 0. |
| `03-registry-before.log` | the registry state found BEFORE the run: catalog empty, both manifests 404, both `localhost:16010/*:e2e` tags present in the LOCAL image store. |
| `04-*.log` | the tier itself, and the verification that followed. |

The `03-` finding is the reason this packet is not the four-minute run it was
supposed to be. Read `03-registry-before.log` before any green in here.
