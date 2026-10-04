import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

/**
 * The lint configuration, and what replaced what.
 *
 * ---------------------------------------------------------------------------
 * THIS USED TO BE `eslint-config-next`, AND THAT PACKAGE IS GONE WITH THE
 * FRAMEWORK IT NAMED
 * ---------------------------------------------------------------------------
 * `eslint-config-next` was not a style choice; it was the only thing that told
 * ESLint how to parse a `.tsx` file in this repository, and it is gone with
 * `next` itself. What replaces it is `typescript-eslint`'s recommended set, plus
 * the two rules below that this repository has an opinion about.
 *
 * `typescript-eslint` is not a new package to this tree: it was already here,
 * resolving to 8.71.0 as a dependency of the config being removed, so promoting
 * it to a direct devDependency adds nothing to `npm ci` and moves no version.
 * The alternative was not "no lint" but a `lint` script that cannot parse
 * TypeScript and exits non-zero on every file in `src/`, which is worse than
 * nothing because it looks like a gate.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO RULES ARE SWITCHED OFF, AND BOTH ARE ABOUT ROUTER FILES
 * ---------------------------------------------------------------------------
 * The recommended set does not know this codebase's conventions, and these two
 * produce a wall of red on correct code:
 *
 *   - `no-explicit-any`. `src/lib/identity.ts` and `src/lib/upstream.ts` parse
 *     two services' responses, and an untrusted body's type is genuinely not
 *     knowable at the point it arrives. Every one is narrowed before use.
 *   - `no-unused-vars`. The base rule counts a prefixed `_` as used; the
 *     TypeScript one does not, which is backwards for the `_event` shape in a
 *     React handler. It is configured to ignore `_`-prefixed names, which is
 *     the convention the rest of the tree already follows.
 *
 * Neither is switched off globally to make a build go green: both are re-enabled
 * below as warnings, so a new one is visible in the output rather than invisible.
 */
const eslintConfig = defineConfig([
  globalIgnores([
    "dist/**",
    "out/**",
    "build/**",
    "coverage/**",
    "e2e-results.json",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
]);

export default eslintConfig;