/**
 * Joins class names. Not a dependency.
 *
 * `clsx` and `tailwind-merge` are the usual answers and both need manager
 * approval (PLAN.md §5). Nothing here overrides another class, so the whole
 * problem is dropping falsy values.
 */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}
