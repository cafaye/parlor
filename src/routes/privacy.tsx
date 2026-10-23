import { createFileRoute } from "@tanstack/react-router";

import { LegalPlaceholder, ProsePage } from "@/components/ui";

/**
 * `/privacy` — the privacy policy page.
 *
 * A placeholder, deliberately, and for the reason `/terms` is: anywaye has not
 * published a privacy policy, and a website that invented one would be
 * printing claims nobody made. See `LegalPlaceholder` for the body and
 * `ProsePage` for the layout; neither carries legal text, and adding any is a
 * legal decision rather than a copy change.
 *
 * The temptation to name something is strongest here, because this deployment
 * really does hold things — identity holds accounts, the browser holds a
 * session token. **None of it is named.** Naming any of it is a data-processing
 * claim nobody has approved, which is the exact failure mode the placeholder
 * exists to avoid.
 *
 * Reads no session, fetches nothing, holds no state.
 */
export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy · parlor" }] }),
  component: PrivacyPage,
});

export default function PrivacyPage() {
  return (
    <ProsePage title="Privacy Policy">
      <LegalPlaceholder document="Privacy Policy" />
    </ProsePage>
  );
}
