# parlor → website screen/route audit (D9 reconciliation)

Written 2026-10-09 on branch `agents-first/recon`. This is the audit half of
D9: `website` is the one customer-facing frontend (D1), and anything in parlor
still worth having must be moved to `website` deliberately, before new screens
land in the wrong tree.

**The surface is screens and routes, and nothing else.** Not the fleet, not the
libs, not the deploy substrate, not a modernization sweep. The verdict column
below is the work; the table is its shape.

## Method

Both trees were compared as route families and screens, not file counts:

- `src/routes/` — every route file in both trees, paired by path.
- `src/app/` — every screen and form module, paired by path, then `diff`ed.
  Byte-identical files are stated as such; every differing file was read to
  determine the *direction* of the difference (which tree is ahead).
- `src/lib/`, `src/components/`, `src/styles/` — compared for parity only, to
  make the reasons accurate. They are not the surface and nothing below moves
  them.

## The audit

| # | parlor family | website counterpart | Verdict | Reason (one line) |
|---|---|---|---|---|
| 1 | `/` landing (`src/app/page.tsx`) | exists | **already-in-website** | website's is the marketing home and is ahead: Anywaye brand, W0-P1 pricing, meta description, brand-titles test. |
| 2 | `/register` | exists | **already-in-website** | `register-form.tsx` is byte-identical; page wrapper identical. |
| 3 | `/login` | exists | **already-in-website** | `login-form.tsx` is byte-identical; page wrapper identical. |
| 4 | `/forgot-password` | exists | **already-in-website** | `forgot-password-form.tsx` is byte-identical. |
| 5 | `/reset-password` | exists | **already-in-website** | `reset-password-form.tsx` is byte-identical. |
| 6 | `/verify-email`, `/verify-email/confirm` | exist | **already-in-website** | both forms byte-identical; page wrappers identical. |
| 7 | `/accounts` | exists | **already-in-website** | `accounts-screen.tsx` is byte-identical. |
| 8 | `/accounts/[accountId]` | exists | **already-in-website** | website is *ahead*: adds `AccountEntitlementPanel` (conductor-backed) and a token-gated sign-in check; parlor has nothing website lacks. |
| 9 | `/invitations/[token]` | exists | **already-in-website** | the only diff is the brand word (`parlor` → `Anywaye`). |
| 10 | `/admin` | exists | **already-in-website** | website is *ahead*: `EntitlementOps` (list/grant/revoke Kit entitlements via conductor) is 300+ lines parlor's console does not have; parlor's has nothing website lacks. |
| 11 | `/settings` (+ `mfa-section.tsx`) | exists | **already-in-website** | both files byte-identical. |
| 12 | `/terms`, `/privacy` | exist | **already-in-website** | brand-only diffs (title + placeholder name). |
| 13 | `/healthz`, `/readyz` | exist | **already-in-website** | handlers identical. |
| 14 | `/v1/*` BFF + `/v1/auth/oauth/$provider/callback` | exist | **already-in-website** | website is *ahead*: the forwarder also targets conductor; the callback route differs only by brand/test ids. |
| 15 | Session shell (`src/components/shell/header.tsx`) | exists | **already-in-website** | the only diff is the brand word. |
| 16 | Design system (`src/styles/tokens.css`, `src/components/ui/`) | exists | **already-in-website** | `tokens.css` identical; the ui barrel differs only in export order. See observation (b) on `button.tsx`. |

**No family is marked `move`.** Every screen and route family parlor has,
website already has — and in every case where the two differ, website is ahead
(brand rename, conductor entitlement surfaces, landing pricing, footer, meta).
There is nothing left in parlor's screens or routes that website lacks.

## Already-planned, not missing

The future-screen promises in AGENTS-FIRST W2–W5 all land in `website` by
construction, so their absence from parlor is correct, not a gap:

| Promise | Packet | parlor has it? |
|---|---|---|
| `/agents/claim/[token]` approval screen | W2-P1 | no — correct |
| `/email-providers` (+ `/cloudflare` form) | W3-P3 | no — correct |
| `/audit` + release-acceptance screens | W3-P3, W5-P2 | no — correct |
| `/boxes` | W3-P3 | no — correct |

## Secondary observations (outside the screen/route surface, recorded for honesty)

These were found while making the reasons accurate. None is a move; the brief
bounds this packet to screens/routes, and each is a component or a doc row,
not a screen.

- **(a) shadcn primitives.** parlor's `badge`/`separator`/`tabs` are the
  house-built versions (no radix/cva, SSR-safe) and carry tests; website wears
  stock shadcn/ui instead, without tests. A component choice website already
  made — not a screen, and not ours to reverse here.
- **(b) `ui/button.tsx` `ink` variant + press scale.** parlor's button has
  them; website's does not. But no parlor screen uses `ink` — only parlor's
  own test does — and website's landing sources `ink` from
  `shadcn/button.tsx`, which has it. Moving it would be shipping an unneeded
  move.
- **(c) A stale README row in *both* trees.** Both READMEs list
  `/billing/plans` under "What is here today"; neither tree has that route
  (the billing screens were removed from the product; the READMEs' own billing
  sections say so). Shared, not a divergence — but the sunset note below should
  not be read as the only stale copy.

## Conclusion

**The audit justifies no moves.** Every screen/route family parlor has, website
already has, and website is ahead in every divergent case. The reconciliation
D9 calls for is therefore complete on the evidence: nothing is worth moving,
and the sunset note in the README is the remaining deliverable.
