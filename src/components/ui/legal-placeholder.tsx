import { linkClasses } from "./link";

/**
 * The placeholder body for a legal page: the honest statement that there is
 * nothing here yet, and the pointers that say what to do about it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SAYS "PLACEHOLDER" OUT LOUD
 * ---------------------------------------------------------------------------
 * cafaye has not published terms of service or a privacy policy, and inventing
 * either would be printing claims nobody made — that is the failure mode this
 * component exists to avoid, and it is named in the fleet's own precedent (the
 * retired `cafaye/site`, whose `REPORT-site-legal-01.md` records the decision
 * and what was ruled out).
 *
 * So the body says the page is a placeholder, tells the operator to update the
 * "Last updated" line when they replace it, and carries the policy generators
 * the precedent suggests. **Replacing any of this with real text is a legal
 * decision with a person attached, not a copy change.**
 *
 * The temptation is strongest on `/privacy`, because this deployment really
 * does hold things — identity holds accounts, the browser holds a session
 * token. None of it is named here. Naming it is a data-processing claim nobody
 * has approved; the placeholder's honesty is that it says nothing rather than
 * something unapproved.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LINKS ARE THE PRECEDENT'S, VERBATIM
 * ---------------------------------------------------------------------------
 * They were chosen by the fleet's precedent for exactly this purpose, and a
 * placeholder page is not a legal-policy review. A visitor who gets as far as
 * `/terms` is being pointed at tools, not at text.
 */
export type LegalPlaceholderProps = {
  /**
   * The document this page stands in for — "Terms of Service" or
   * "Privacy Policy". Lowercased into the sentences below.
   */
  document: string;
};

/** The policy generators the precedent suggests, in its order. */
const POLICY_GENERATORS: readonly { href: string }[] = [
  { href: "https://github.com/basecamp/policies" },
  { href: "https://www.iubenda.com" },
  { href: "https://termly.io" },
  { href: "https://getterms.io" },
];

export function LegalPlaceholder({ document }: LegalPlaceholderProps) {
  return (
    <>
      <p className="text-muted">
        This page is a placeholder. Cafaye has not published its {document.toLowerCase()} yet, and
        what follows is the honest state of that — not a draft of it.
      </p>
      <p className="text-muted">
        Don&apos;t forget to update the Last updated line above after modifying this page.
      </p>
      <p className="text-muted">Some suggestions to help create your {document}:</p>
      <ul className="flex list-disc flex-col gap-2 pl-6">
        {POLICY_GENERATORS.map((generator) => (
          <li key={generator.href}>
            <a className={linkClasses} href={generator.href} rel="noreferrer">
              {generator.href}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
