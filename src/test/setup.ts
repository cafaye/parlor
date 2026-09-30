import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL only self-registers cleanup when vitest runs with `globals: true`. We
// import describe/it/expect explicitly instead (no ambient globals leaking into
// app code), so the unmount has to be wired by hand — without it, rendered
// trees accumulate across tests in a file and every getBy* finds duplicates.
afterEach(cleanup);

// The session token lives in localStorage, and it is read synchronously on
// every render. A token left behind by one test would sign in the next one and
// make an auth suite pass for the wrong reason, so the sweep is global rather
// than something each auth test remembers to do.
afterEach(() => localStorage.clear());
