"use client";

/**
 * `/boxes` — the caller's box installations, with status and phase.
 *
 * ---------------------------------------------------------------------------
 * WHAT A BOX ROW IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * Box records installation STATE only (boundary 8): the box's own
 * identity, which account it belongs to, whether it is enrolling, active or
 * disabled, and the install phase the box last reported. A row here is
 * exactly that and nothing more — no SSH key, no box credential, no root,
 * no public key. There is nothing on this screen a person could use to act
 * on their box from here, and that is the point: the box acts on a
 * capability, never the reverse.
 *
 * The words are the service's. `enrolling`, `active`, `disabled`,
 * `pending`, `enrolled`, `installing`, `complete`, `failed` are
 * `Installation::STATUSES` and `::PHASES`, and a screen that renamed them
 * would ask a reader to translate. The only thing added here is the
 * sentence under a row saying where the box is in its install, which is
 * reading the two fields the service sent rather than inventing a third.
 *
 * ---------------------------------------------------------------------------
 * NO DETAIL LINK, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `Zone B` names a `/boxes/$id` and it is not built. The house rule is that
 * an absent surface is absent rather than disabled, so these rows are
 * static: no link to a screen that does not exist. A detail route is the
 * successor's work, and when it lands these rows gain a `CardLink` the same
 * way the accounts rows have one.
 */

import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
} from "@/components/ui";
import { useAccountScopedList } from "@/lib/account-scope";
import { type Box, type BoxPhase, type BoxStatus } from "@/lib/box";
import { useBox } from "@/lib/box-context";
import { useAuth } from "@/lib/auth";
import { SignedOut } from "./page";

const LOAD_FAILED = "We could not load your boxes.";

/**
 * The service's status words, rendered.
 *
 * A map and not `toUpperCase`, because `pending` as a phase and "Waiting to
 * enroll" are not the same sentence: the phase word is what the box reported,
 * and the reader's gloss under a row is separate copy this file owns.
 */
const STATUS_LABEL: Record<BoxStatus, string> = {
  enrolling: "Enrolling",
  active: "Active",
  disabled: "Disabled",
};

const PHASE_LABEL: Record<BoxPhase, string> = {
  pending: "Pending",
  enrolled: "Enrolled",
  installing: "Installing",
  complete: "Complete",
  failed: "Failed",
};

/** Where the box is, in one sentence, from the two fields the service sent. */
function phaseSentence(status: BoxStatus, phase: BoxPhase): string {
  if (status === "disabled") return "This box was decommissioned.";
  if (phase === "failed") return "The install failed on this box.";
  if (phase === "complete") return "The install finished on this box.";
  if (phase === "installing") return "The substrate is installing on this box.";
  if (phase === "enrolled") return "This box has enrolled and has not started installing.";
  return "A capability is live for this box and it has not enrolled yet.";
}

export function BoxesScreen() {
  const { session, token } = useAuth();
  const box = useBox();
  const boxes = useAccountScopedList<Box>("boxes", (t, accountId) =>
    box.listBoxes(t, accountId),
  );

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous" || token === null) return <SignedOut />;

  if (boxes.notConfigured) {
    return (
      <Panel headingId="boxes" title="Boxes">
        <p className="text-sm text-muted">Boxes are not configured on this deployment.</p>
      </Panel>
    );
  }

  if (boxes.accountsFailed) {
    return (
      <Panel headingId="boxes" title="Boxes">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={boxes.retry}
          title="We could not load your accounts."
        />
      </Panel>
    );
  }

  if (boxes.loading) {
    return (
      <Panel headingId="boxes" title="Boxes">
        <LoadingState label="Loading your boxes…" />
      </Panel>
    );
  }

  if (boxes.readFailed) {
    return (
      <Panel headingId="boxes" title="Boxes">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={boxes.retry}
          title={LOAD_FAILED}
        />
      </Panel>
    );
  }

  if (boxes.rows.length === 0) {
    return (
      <EmptyState title="No boxes yet">
        You have no enrolled boxes. A box appears here when an enrollment capability is
        redeemed on the machine you want to run the substrate on.
      </EmptyState>
    );
  }

  return (
    <ul aria-label="Your boxes" className="flex flex-col divide-y divide-border">
      {boxes.rows.map(({ accountId, accountName, row }) => (
        <li key={`${accountId}-${row.box_id}`} className="flex flex-col gap-2 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Short form only, and never the whole id: a box id is not a
                secret, but a row that printed it in full would be a row
                somebody pastes into a support ticket by mistake. */}
            <span className="font-mono text-sm font-medium">{row.box_id.slice(0, 8)}…</span>
            <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs text-muted">
              {STATUS_LABEL[row.status]}
            </span>
            <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs text-muted">
              {PHASE_LABEL[row.current_phase]}
            </span>
            <span className="text-xs text-muted">{accountName}</span>
          </div>
          <p className="text-sm text-muted">{phaseSentence(row.status, row.current_phase)}</p>
        </li>
      ))}
    </ul>
  );
}
