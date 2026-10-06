# REPORT — parlor-profile-01

Branch `worker/parlor-w15-profile`. No code committed. The screen cannot be
built: the identity API does not support three of the four capabilities the
brief asks for. This report is the diagnosis the brief's final line asks for
rather than a half-built screen.

---

## 1. What the brief asks for, and what exists

The brief asks for a profile screen with four sections:

| Section | Capability needed | Exists in identity? |
|---|---|---|
| Display name (read + update) | `GET /v1/me` returning a name + a route to update it | **No** |
| Current session | Read the caller's session | **Yes** — `GET /v1/me` |
| Other sessions with a revoke control | A route to list sessions + a route to revoke one | **No** |
| Delete-account control | A route to delete the caller's user account | **No** |

One of four is buildable. The other three have no route, no store method, and
no field to read or write. Building them would mean rendering controls that
call nothing — which the brief forbids: *"Do not build a control for a route
that is withheld or refused. If a capability is not reachable, the screen must
not pretend it is."*

---

## 2. The exact routes that do exist

Transcribed from `identity/internal/httpapi/` (the handler, not the OpenAPI
document — same rule parlor already uses for the tenancy shapes).

### 2.1 Reading the current user

```
GET /v1/me
  → 200 {id, email}
  → 401
```

- Handler: `handleMe` in `identity/internal/httpapi/auth.go:453`
- Response type: `userResponse{ID, Email}` in `auth.go:103-106`
- The OpenAPI `User` schema (`identity/openapi/v1.yaml:5566-5581`) declares
  `additionalProperties: false` with exactly `[id, email]`. There is no display
  name field. Adding one is a contract change on the service side.

### 2.2 Updating the current user

**No route exists.** The complete set of user routes in the service is:

```
POST   /v1/users                    register
GET    /v1/me                       read current user
POST   /v1/users/{userID}/disable   operator-only
POST   /v1/users/{userID}/enable    operator-only
```

There is no `PATCH /v1/me`, no `PATCH /v1/users/{id}`, no `PUT` of any user
resource. The only PATCH routes in the entire service are:

```
PATCH /v1/accounts/{accountID}                    rename account (admin)
PATCH /v1/accounts/{accountID}/members/{userID}   change member role (owner)
PATCH /v1/mfa/enrollments/{enrollmentID}/confirm MFA
PATCH /v1/accounts/{accountID}/oidc-clients/{id}   OIDC client
```

The `users.Store` (`identity/internal/users/store.go`) has `Create`, `ByEmail`,
`ByID`, `RecordFailedLogin`, `ClearFailures`, `SetPassword`, `SetEmail`,
`Disable`, `Enable`, `MarkEmailVerified`. There is no `UpdateName`, no
`Delete`. The `User` struct (`users.go:74-94`) has `ID`, `Email`,
`PasswordDigest`, `FailedLoginAttempts`, `LockedUntil`, `EmailVerifiedAt`,
`DisabledAt`. No name field.

### 2.3 Listing sessions

**No route exists.** The sessions store
(`identity/internal/sessions/store.go`) has four methods:

```
Create           insert a session
ByToken          resolve a presented token to a live session
Revoke           delete one session by ID
RevokeAllForUser delete every session for a user
```

There is no `List` / `ListForUser` / `AllForUser`. No HTTP route enumerates
sessions. The only session routes are:

```
POST   /v1/session   login (mints a session)
DELETE /v1/session   logout (revokes the caller's current session)
POST   /v1/session/mfa   complete second factor
```

`DELETE /v1/session` (`handleLogout`, `auth.go:424`) resolves the caller's
presented token via `presentedToken` and revokes that one session. It cannot
revoke a session the caller is not currently holding.

### 2.4 Revoking a specific session

**No route exists.** `Revoke(ctx, q, sessionID)` in the store can delete any
session by ID, but no HTTP route exposes it. A `DELETE /v1/sessions/{id}` or
`DELETE /v1/users/{userID}/sessions/{id}` does not exist.

### 2.5 Deleting the account

**No user-account route exists.** The only delete in the user surface is:

```
DELETE /v1/accounts/{accountID}   delete a tenancy account (owner-only)
```

This removes an *account* (a tenancy), not a *user*. It is already in
parlor's client (`deleteAccount` in `src/lib/identity.ts:221`) and already in
the forwarder's `ROUTES` table (`upstream.ts:346`). The `users.Store` has no
`Delete` method. The operator routes (`POST /v1/users/{id}/disable` and
`/enable`) can turn an account off but not remove it.

---

## 3. What the screen could use

If the identity API is extended, these are the routes a profile screen would
need, against the shapes the service already has:

| Needed route | Shape to follow | Store method to add |
|---|---|---|
| Read display name | `GET /v1/me` → add `name` to `userResponse` | none (read existing column) |
| Update display name | `PATCH /v1/me` `{name}` → `{id, email, name}` | `UpdateName` on `users.Store` |
| List sessions | `GET /v1/sessions` → `[{id, user_agent, ip, created_at, expires_at, current}]` | `ListForUser` on `sessions.Store` |
| Revoke a session | `DELETE /v1/sessions/{id}` → 204 | `Revoke` (exists) |
| Delete user account | `DELETE /v1/me` or `DELETE /v1/users/{id}` → 204 | `Delete` on `users.Store` |

The `identity-w17-sessions` worktree exists at `/Users/kaka/Code/any/wt/identity-w17-sessions`
on branch `worker/identity-w17-sessions` but has **zero commits beyond master** —
the session-management packet has not started. That is the packet that would
add the list and revoke routes.

---

## 4. What the identity API supports that this screen does not yet use

These are existing, reachable capabilities a profile screen could show even
without new routes:

1. **Email verification status** — `GET /v1/email-verification` →
   `{email, email_verified, email_verified_at?}`. A "verified" badge on the
   profile. Already in the client (`verificationStatus`) and the forwarder
   table.

2. **Resend verification email** — `POST /v1/email-verifications` → 202. A
   "resend" control when `email_verified` is false. Already in the client
   (`requestEmailVerification`) and the forwarder table.

3. **Sign out** — `DELETE /v1/session` → 204. A "sign out" control. Already
   in the client (`logout`) and the forwarder table.

4. **Personal account name** — `GET /v1/accounts` lists the user's personal
   account (created at registration with `PersonalName(email)`), and
   `PATCH /v1/accounts/{id}` renames it (the user is the owner). This is the
   closest thing to a "display name" the API has, but it is the *account's*
   name, not the user's — it is shown on the accounts screen, not a profile.

5. **Session expiry** — the token store (`src/lib/token-store.ts`) already
   holds `expires_at` from login. A "session expires at" line needs no new
   route.

---

## 5. Why this is a report and not a screen

The brief's final line: *"If you run out of budget, stop and write the
diagnosis rather than landing a half-built screen."* The budget is not the
constraint — the API is. Three of the four sections have no route to call.
Building them would produce a screen with three dead controls, which the
brief's own constraint forbids. The diagnosis is the deliverable.

The `identity-w17-sessions` packet is the one that closes the session gaps.
When it lands, the list and revoke routes become buildable. The display-name
and user-deletion gaps need their own packets on the identity side.
