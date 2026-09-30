import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL only self-registers cleanup when vitest runs with `globals: true`. We
// import describe/it/expect explicitly instead (no ambient globals leaking into
// app code), so the unmount has to be wired by hand — without it, rendered
// trees accumulate across tests in a file and every getBy* finds duplicates.
afterEach(cleanup);
