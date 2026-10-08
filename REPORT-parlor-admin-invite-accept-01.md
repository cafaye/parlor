# REPORT — parlor-admin-invite-accept-01

Two-person account administration, proved in a real browser against the real
stack. Branch `worker/parlor-admin-audit`, worktree
`parlor-worker-parlor-admin-audit`.

## The redirect, and why there is no audit panel

The original brief asked for an activity-history panel on
`/accounts/$accountId` backed by Identity's `GET
/v1/accounts/{account_id}/admin/audit-log`. The contract investigation killed
that shape before any code was written, and the redirect confirmed the kill:

- `identity/internal/httpapi/admin.go` (`requireAdminToken`, R4): every admin
  route REFUSES a browser session with 403. Only a scoped API key (`cafaye_`
  prefix, `audit_log:read`) reaches the handler.
- Identity's own OpenAPI says it outright on the 403:
  "or **a browser session was presented** — the admin surface is token-only."
- Audit rows are written only by the admin revocation routes
  (`invitation.revoked`, `invitations.revoked`), which need the same machine
  credential. Nothing a browser session can do — invite, accept, rename —
  writes an audit row, so the e2e harness cannot produce an audit event
  through existing account/invitation flows either.
- No single server-side secret fixes it: admin tokens are account-scoped, so
  one operator key cannot read every account's trail, and threading a machine
  credential through a browser-facing path is the unsafe shape the redirect
  forbids.

So the audit history remains operator-machine-only and is not rendered in
Parlor. No client method, no forwarder entry, no panel, no `openapi/v1.yaml`
edit — the tree has zero audit-log surface, and that is the correct diff.

## What was built instead

One file: `e2e/account-admin.e2e.spec.ts`. One test, the customer-admin
workflow the session surface actually supports and no spec yet covered
end to end:

1. Owner registers + signs in (context 1), opens their personal account,
   invites a second address as member through the real invite form, reads the
   one-time link it renders.
2. Guest registers the invited address + signs in **in a second browser
   context** — two people, two storage partitions; the only thing crossing
   contexts is the invitation link — visits the link, accepts. "You are in" /
   "You joined as member."
3. Guest follows "Go to the account": Members renders, "Invite somebody" does
   not (`can("member", "inviteMember")` is false — the role gate pinned, not
   the service's refusal).
4. Owner reloads: member list has 2 rows; owner promotes the guest via the
   row's role control (owner-only `PATCH .../members/:userId`, located by
   current value not position) and the row reads back `admin` from a refetch.

Rendered text/roles only, no sleeps, no skips, both session tokens recorded
for the teardown scan. Role contract source: `src/lib/roles.ts` matrix
(changeMemberRole owner, removeMember admin, inviteMember admin) transcribed
from identity's `registerTenancyRoutes`.

## Evidence

- `timeout 600 npm ci` — exit 0.
- `npm run typecheck` — clean.
- Earlier focused invocation `./bin/e2e -- e2e/account-admin.e2e.spec.ts` —
  1 passed (8.5s); teardown scanned for 2 session tokens, none found in
  artifacts; stack brought down with volumes deleted. The harness then exited
  red at its `MINIMUM_TESTS = 2` floor: the floor guards the full tier against
  silent filtering, so tripping it under an explicit file filter is the
  mechanism working, not a test failure. That focused invocation was not a
  green tier run and is not claimed as one.
- Final combined invocation (manager-observed, `/tmp/gate-parlor-admin-audit.e2e2.log`):
  `./bin/e2e -- e2e/account-admin.e2e.spec.ts e2e/settings-invitations.e2e.spec.ts` —
  **4 passed, 0 failed, 0 skipped, 0 retried (18.2s)**, including the
  owner-invites/guest-accepts/owner-promotes scenario
  (`e2e/account-admin.e2e.spec.ts:139`) plus the three
  `e2e/settings-invitations.e2e.spec.ts` tests; teardown scanned 0 produced
  files for 2 session tokens (none found) and `parlor-e2e` stopped with its
  volumes deleted. This combined invocation is the green tier evidence. The
  filtered E2E invocation should not be repeated; the full-tier green on the
  merged tree belongs to the manager's gate, which runs the unfiltered suite.

## What remains (manager)

- Nothing in this packet is half-done. No unit tests were touched or weakened;
  no backend/API-key feature was added.
- Suggested follow-ups, neither taken: a unit-tier assertion that member rows
  render addressable controls when `user_id` is present (covered here e2e
  instead); an identity-side decision on whether sessions should ever read the
  audit trail (their R4 says no — this report takes that as settled).
