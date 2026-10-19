import * as Sentry from "@sentry/browser";

let initialized = false;

export function initErrorReporting(): void {
  if (initialized || typeof window === "undefined") return;
  const dsn = import.meta.env.VITE_PARLOR_ERROR_REPORTING_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: import.meta.env.VITE_PARLOR_RELEASE || import.meta.env.VITE_COURIER_RELEASE || "unknown",
    environment: import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT || "production",
    beforeSend(event) {
      if (event.exception?.values) {
        for (const e of event.exception.values) e.value = undefined;
      }
      if (event.request) {
        event.request.url = undefined;
        event.request.query_string = undefined;
      }
      return event;
    },
  });
  initialized = true;
}

export function captureError(error: unknown): void {
  if (typeof window === "undefined") return;
  Sentry.captureException(error);
}
