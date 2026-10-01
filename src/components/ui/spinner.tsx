/**
 * A busy indicator. Decorative, and it says so.
 *
 * `aria-hidden` is the whole design, and it is worth being precise about why,
 * because "add a label to the spinner" is the obvious fix and the wrong one.
 * Whatever is busy already announces itself: a button carries `aria-busy`, a
 * loading state is a `role="status"` with a sentence in it. A spinner WITH an
 * accessible name is a third announcement of a fact the person has already
 * heard; a spinner WITHOUT one is a graphic a screen reader either skips or
 * announces as "image". Neither helps anybody, and the first is actively
 * annoying.
 *
 * So the spinner is decoration, the control is the announcement, and this
 * file exists separately from `feedback.tsx` mostly so that `button.tsx` can
 * use it without importing a module that imports `button.tsx` back.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={["size-4 shrink-0 animate-spin motion-reduce:animate-none", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="spinner"
      fill="none"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" opacity="0.25" r="6" stroke="currentColor" strokeWidth="2" />
      {/* A three-quarter arc rather than a full ring, so "busy" is legible
          without animation — which is the state a reduced-motion setting puts
          it in, and the state a screenshot puts it in. */}
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
