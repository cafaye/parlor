/**
 * The query string, as a plain object.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROUTES DO NOT JUST READ `Route.useSearch()`
 * ---------------------------------------------------------------------------
 * Two of the three pages that read a query — `/login`, `/reset-password`,
 * `/verify-email/confirm` — read it to decide one thing each, and in two of
 * the three the PRESENCE of the key is the signal and its value is never read.
 * The third takes a bearer credential out of it.
 *
 * `useSearch()` on a route with no `validateSearch` is typed `{}` and carries
 * nothing, which would mean either declaring a search schema per route (three
 * schemas, to learn three facts) or reaching past the router to
 * `location.searchStr`. This is the second of those, wrapped once so the three
 * call sites are one line each and the "first value wins on a repeated key"
 * rule has exactly one implementation.
 *
 * `Object.fromEntries` is that rule: a repeated parameter keeps the FIRST value,
 * which is what `URLSearchParams.get` does and what a person with a malformed
 * link means. It is not `getAll`, and not the last value, because a link with
 * `?token=a&token=b` is malformed and the service answers 404 for either.
 */
export function searchParamsOf(searchStr: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(searchStr));
}