# The cafaye design system

How to build a screen in this app. Read this before writing a new one; it is
shorter than the code it replaces.

Everything here is a decision with a reason. Where a decision is a judgement
call rather than a measurement, it says so, because the next person to change
it should know whether they are arguing with taste or with arithmetic.

---

## The short version

| If you need | Reach for |
| --- | --- |
| Something a person clicks to commit | `Button` |
| Something that navigates | `TextLink` (in a sentence) or `CardLink` (a whole row) |
| A field with a label | `Field` wrapping `Input` or `Select` |
| A form failed, as a whole | `FieldSummary` — one per form |
| Something went wrong, with a retry | `ErrorState` |
| Something is in flight | `LoadingState` |
| There is nothing here | `EmptyState` |
| A group of related facts | `Panel` |
| A note inside a panel | `Callout` |
| Something irreversible | `ConfirmDialog` |
| A card to put things on | `Surface` |
| A term and its value | `DescriptionList` |
| A person's role | `RoleBadge` |
| A name for a screen reader only | `VisuallyHidden` |

One import path: `@/components/ui`. Do not reach past it.

### Which of these are adopted today

Screens still carry some hand-written markup from before this packet, and
migrating every screen is deliberately follow-on work. So this is honest about
what is in use and what is waiting:

| Adopted by a screen today | Ready, awaiting migration |
| --- | --- |
| `Button` (all four variants) | `Surface` — 10 hand-written cards |
| `Input`, `Select`, `Field`, `FieldSummary` | `TextLink`, `CardLink` — 10 hand-written links |
| `ConfirmDialog` (both destructive actions) | `VisuallyHidden` — no icon-only control needs it yet |
| `Callout` (via `ErrorState`, `FieldSummary`) | `Spinner` (used by `Button` and `LoadingState`, not directly) |
| `Spinner` (via `Button busy`) | |
| `Panel`, `EmptyState`, `ErrorState`, `LoadingState`, `DescriptionList`, `RoleBadge` | |

The right-hand column is not unfinished work dressed up — those components are
the replacements for markup that is demonstrably duplicated, and the migration
list at the end of this document is the plan. `VisuallyHidden` is the one that
might never get used, and it is here because the first icon-only control will
need it and shipping a `1px`-clip helper at that point would be worse.

---

## The design, and why

### The ground is paper. The text is ink.

cafaye's product is a ledger: accounts, memberships, invitations, plans, money.
So `neutral` is a **warm** low-chroma grey (hue 38), not the cold blue-grey
that infrastructure products ship by default, and the primary text is a soft
black-brown rather than a neutral grey.

The practical consequence you will feel: it reads like a document, not a
dashboard. That is the intent, and it is why panels have hairlines and no
shadows — a sheet on a desk is separated by its own edge.

### There is one chromatic voice, and it is scarce

`seal` is a deep petrol-teal, and it is used for **the things you can act on**:
links, the focus ring, and nothing else. It is not used on headings, not used
for decoration, not used for "brand-ness".

This is the rule that makes the palette mean something. A colour that appears
everywhere carries no information. Spend it rarely and it becomes legible as
"this is interactive" without anybody having to be told.

### The primary action is ink, not seal

The filled primary button is `accent`, which is **near-black in light mode and
light teal in dark mode**. That inversion is the reason `--color-on-accent` is
a token rather than a `#ffffff` sprinkled through the button variants: a filled
button needs text on it, and that text is near-white in one theme and near-black
in the other.

The accent is ink so that seal stays scarce. A seal-filled primary button would
spend the one chromatic voice on the least interesting thing on the page.

### Status is warm and earthy

`positive` is moss, `caution` is ochre, `critical` is brick. They are editorial
marks on a page rather than software alerts, and none of them is confusable
with the seal: a status is a fact about something, seal is an invitation to do
something.

Each has a `-surface` partner for the tinted panel it sits on. Both are
contrast-checked in both themes by `src/styles/tokens.test.ts`.

### No shadows, except the dialog

`--shadow-dialog` is the only elevation in the system, and `ConfirmDialog` is
its only consumer. A screen of shadowed cards is a screen where nothing looks
like the most important thing.

### Motion: 120ms and 200ms, and nothing that moves

Two durations. Only `color` and `transform` animate — never `width`, `height`,
`top` or `margin`, because a form that reflows under the cursor is a form
people mis-click. Every transition carries `motion-reduce:transition-none`, so
`prefers-reduced-motion: reduce` gets the same interface with no movement.

---

## The four decisions that were measured, not chosen

These are the ones where the answer came out of arithmetic, and the numbers are
asserted in `src/styles/tokens.test.ts` so they cannot rot.

### 1. There are two text weights, not three

A third step between `foreground` (16.10:1 on paper) and `muted` (5.46:1) was
tried and does not work. The band between 4.5:1 and 7:1 on this ramp is about
1.4 lightness steps wide, so a "subtle" step either misses 4.5:1 or is
indistinguishable from `muted`.

There is no `--color-placeholder` token either, for the same reason and with a
sharper consequence: **a placeholder is text and owes 4.5:1**, so a compliant
placeholder is exactly `muted`. A paler one is a WCAG failure, and a
"placeholder" that disappears when somebody types is help text nobody reads.
Put help text in `Field`'s `hint`, which is a real `<p>` with an id.

### 2. The focus ring is a halo, and its offset is load-bearing

This one is counter-intuitive enough to be worth reading twice.

A focus indicator is a **non-text** element (SC 1.4.11), so its floor is 3:1,
not 4.5:1. Measured:

| | light | dark |
| --- | --- | --- |
| ring on `surface` | 3.74:1 | 9.79:1 |
| ring on `surface-raised` | 3.91:1 | 8.79:1 |
| ring on `surface-sunken` | 3.59:1 | 10.40:1 |
| **ring on the primary fill** | 4.30:1 | **1.00:1** |

In light mode the ring would be visible even flush against the button. In dark
mode it is the *same colour* as the fill — 1.00:1 — and no hex nudge fixes it,
because the ground is near-black and the primary fill is a light teal and no
single colour is 3:1 from both ends of that range.

What makes the ring visible is the **2px gap** that `outline-offset` opens, and
that gap is painted by the *ground* the control sits on. So:

- the ring is tuned against the **grounds**, never the fills;
- the offset is not cosmetic, and `tokens.test.ts` fails if any `.focus-ring`
  rule sets it to zero;
- it is **one utility** (`focus-ring` in `tokens.css`), applied by every
  interactive primitive, because a ring defined per component is a ring that
  eventually gets an override.

`outline` and not `box-shadow`, because outlines are what Windows High Contrast
Mode honours.

### 3. Status ramps earn steps when a pairing needs one

`--color-brick-300` exists for exactly one measured reason: on its own tinted
dark surface, `brick-400` scores 4.11:1 and misses the 4.5:1 text floor by a
third of a point. A step is added when a pair requires it, not because 50–950
looked tidy.

Similarly `--color-border-strong` is `neutral-500` in dark mode rather than
`neutral-600`, because on `surface-raised` — a card, which is *lighter* than the
page in dark mode — 600 measures 2.95:1 and misses the 3:1 non-text floor by
0.05.

### 4. The ramps are monotone in luminance

Tested, per ramp, per step. A ramp with two steps at the same lightness is a
ramp where `-300` and `-400` are indistinguishable, and the first person to hit
that has no way to know which they meant.

---

## Component contracts

Every interactive primitive in this system owes four things, and
`src/components/ui/controls.test.tsx` asserts all four for all of them in one
table rather than repeating them per file:

1. **Reachable by keyboard.** It is a real focusable element.
2. **Operable by keyboard.** It is a `<button>` or `<a>`, not a `div` with a
   role and a click handler.
3. **A visible focus ring**, from the shared `focus-ring` utility.
4. **An accessible name** somebody could search for.

### `Button`

| Variant | Use it for |
| --- | --- |
| `primary` | The one thing this screen commits. At most one. |
| `secondary` | Everything else that is still an action. |
| `ghost` | Tertiary: "Cancel", "Dismiss". |
| `destructive` | **Only** irreversible actions. Once per screen, inside a `ConfirmDialog`. |

Sizes: `sm` (32px) for a dense table row, `md` (36px) for a page.

Three rules:

- **It keeps its name when busy.** A button that renames itself from "Create
  account" to "Creating…" cannot be found by name mid-interaction. It goes
  `disabled` + `aria-busy` instead, and the `Spinner` it shows is
  `aria-hidden` because the `aria-busy` is the announcement.
- **`type` defaults to `button`.** A bare `<button>` in a form is a submit, and
  "Cancel" posting a form is a bug this default makes impossible.
- **There is no `href`.** A button that navigates is a link, and a link that
  submits is a button. Use `TextLink`. The absence is what stops the wrong thing
  being easy.

`busy` only draws the spinner. You still own `disabled` and `aria-busy` — a
control can be busy and still clickable, or clickable and not busy. **Pass all
three**: this repo had ten buttons setting `aria-busy` and `disabled` with no
`busy`, so a busy button's only visual change was reduced opacity — which is
indistinguishable from "this control is unavailable to you". A person could not
tell "working" from "you cannot do this".

### `ConfirmDialog`

```tsx
<ConfirmDialog
  busy={isPending}
  confirmLabel="Delete this account"
  description="The account and everything scoped by it are removed. There is no undo."
  onCancel={close}
  onConfirm={destroy}
  open={confirming}
  title="Delete this account?"
/>
```

Four decisions inside it, all tested:

- **Focus lands on Cancel.** The safe default for a destructive action is the
  one that does nothing. A spacebar somebody is already holding must not
  destroy anything.
- **The scrim does not close it.** Escape and Cancel do. A confirmation that
  dismisses on an accidental click outside confirms nothing.
- **Focus returns to the control that opened it.**
- **Escape is ignored while busy**, so the dialog cannot vanish mid-delete.

`confirmLabel` is required and must be the action's own name. "Confirm" and "OK"
are how people click through things they did not read.

**The opener and the confirm must not share a name.** "Leave" opens the dialog;
"Leave this account" commits it. The first version had both as "Leave this
account", and a screen-reader user hitting that dialog got two controls with one
name and no way to say which was which — a strict-mode violation in a
component's own test suite. Short opener, full confirm.

It is built on `div[role=dialog]` rather than native `<dialog>`, because
jsdom does not implement `showModal()` — every property that makes a native
dialog good would be untestable in the tier this repo gates on. The trade is
real and stated in the source: the focus trap is ours, and ours can be wrong.
The trap's focusable list deliberately applies **no visibility filter**: the
usual `offsetParent !== null` guard empties the list for a `position: fixed`
dialog, and jsdom reports it `null` unconditionally, so the guard is both wrong
in a browser and untestable here.

**Both destructive actions on the account screen are confirmed, not one.**
Deleting is dramatic; leaving is quiet, and quiet irreversible things are the
ones clicked by accident. The copy above the leave button already said "You will
need a new invitation to come back" — the screen was telling somebody the
action was irreversible while offering it in one click.

### `Field` and `FieldSummary`

`Field` owns the three relationships: which control the label names, what
describes it, and whether it is invalid. **Never hand-wire `aria-describedby`
at a call site** — that is how a screen reader announces "invalid" and drops the
reason.

`aria-describedby` carries both ids when both exist, hint first: what this is,
then why it is complaining.

`FieldSummary` is the form's own alert region: **one per form, never per
field.** It is critical and assertive by default — the one place in a form that
should interrupt, because the form as a whole has failed.

### The state components

- `LoadingState` — `role="status"`, label required. A spinner with no label is
  a silent pause indistinguishable from a hung page. Pass `rows={3}` for a
  list-shaped wait; the skeletons are `aria-hidden` because the sentence is the
  announcement.
- `ErrorState` — `role="alert"`, and the retry is a real `Button` so it is
  keyboard-reachable and keeps its name when busy. You pass the copy: this
  component will never invent a sentence about a failure it cannot see.
- `EmptyState` — a heading, and deliberately **not** an alert. An empty list is
  an answer, not a failure.
- `Panel` — `role="region"` + `aria-labelledby`. A heading alone is not a
  landmark. `headingId` is **required** because an unnamed landmark shows up in
  the landmarks list as "region" with nothing after it.

---

## The rules that are not negotiable

- **`tokens.css` is the only place a colour lives.** A hex in a component is a
  brand decision made in the wrong file, it survives the dark remap as a bright
  patch, and it is invisible in review because it looks like a colour.
  `tokens.test.ts` walks `src/components` and fails on any hex literal.
- **Reach for the semantic layer** (`bg-surface`, `text-muted`, `text-critical`),
  not the raw ramps. The ramps are for tokens and accents. A semantic token
  flips in dark mode without the component knowing dark mode exists.
- **Never render a service's `detail`.** It is where a host, a port or an
  internal class name lives. Every sentence in this app is written in the file
  that renders it.
- **A busy control keeps its name.**
- **A destructive control is `variant="destructive"` and lives in a
  `ConfirmDialog`.**

---

## What is deliberately not here

Not an oversight — each of these is a decision, and a "design system" that
ships everything is a pile of exports.

- **A theme toggle.** Dark mode is `prefers-color-scheme` only. A toggle needs
  a persisted choice and a flash-free first paint, and neither exists. The
  tokens are structured for one (`[data-theme]` is a two-line change in
  `tokens.css`), and that is where it lands.
- **A `Table`.** The list-shaped screens here use `<ul>`/`<li>` with an
  `aria-label`, which is correct for a list of records where each row is a link
  or a control rather than a grid of cells. When a real grid appears — and the
  plans list will want one — it gets a `Table` with `caption` and
  `scope`, and it gets its own tests.
- **A `Tabs` component.** Nothing here has tabs. When something does, it should
  be links with `aria-current`, not a widget, unless the panels are genuinely
  client-side.
- **A `Toast`.** It implies an announcement policy — how many, for how long,
  whether they interrupt — and no screen here needs one. An `ErrorState` in
  place is better than a toast nobody can re-read.
- **A `Fieldset`/`Legend`.** No form here has a group of related fields that
  needs one. When one does, a `<fieldset>` is a one-line addition and does not
  need a component.
- **A `Modal` as a general primitive.** `ConfirmDialog` is built for one job. A
  general modal needs a decision about what happens to the page behind it, and
  that decision has not been made.
- **Skeleton loading for everything.** `LoadingState` with `rows` covers a list.
  A full-page skeleton is a guess about layout that is wrong more often than it
  is right.

---

## Migrating a screen

Screens still use some hand-written links and cards from before this packet.
Migrating every screen is follow-on work, deliberately, because doing both at
once makes neither reviewable. When you touch a screen:

1. `className="font-medium underline underline-offset-2 hover:no-underline"`
   on a `<Link>` → `<TextLink>`. You get a focus ring; the hand-written one had
   none, which is invisible in review and unusable by keyboard.
2. `rounded-lg border border-border bg-surface-raised px-4 py-6` →
   `<Surface>`. Ten copies existed and two of the paddings had already drifted.
3. `rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted`
   → `<EmptyState>`, or `<Callout tone="note">` inside a panel.
4. `rounded-md border border-critical/40 bg-critical/5` → `<Callout
   tone="critical">`, or `<ErrorState>` if there is a retry.

Run `npm test` after each. The screen tests assert roles and names, so they
should not need changing; if one does, that is a finding, not a chore.

---

## What the e2e tier adds, and why it exists

Every other assertion about these primitives is made in jsdom, and jsdom does
not load the stylesheet, does not evaluate `@media (prefers-color-scheme)`, and
computes no layout. So the unit tier can prove a control has a focus-ring
*class* and cannot prove the ring is *painted*.

`e2e/design-system.e2e.spec.ts` closes that gap, and it is worth knowing which
assertions are only possible there:

- the `outline-width` is non-zero and the `outline-offset` is, on **every**
  control a real Tab walk lands on;
- the ring's contrast against the resolved surface, measured in the browser;
- every painted text colour on the login page clears 4.5:1 (3:1 at ≥24px), with
  the background taken from the nearest painted ancestor;
- `prefers-color-scheme: dark` repaints the page, and the text ends up lighter
  than the ground;
- the account deletion is keyboard-only operable, with no `.click()` anywhere in
  the flow.

Verified by breaking it: replacing `.focus-ring` with `outline: none` fails the
first two of those in the browser, and nothing in `npm test` notices — which is
the whole reason the file is here.

One thing in it looks like a sleep and is not. The busy-button test holds
`POST /v1/users` open with `page.route` so the busy state is observable at all.
That is a Playwright API, not a timer: the request has provably not returned, so
the button is provably busy, and every assertion below it is about a guaranteed
state rather than one raced for.
