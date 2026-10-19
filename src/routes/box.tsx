import { createFileRoute } from "@tanstack/react-router";

import BoxPage from "@/app/box/page";

/**
 * `/box` — the Cafaye Box surface.
 *
 * RENAMED FROM `/boxes` by the names/URLs plan (§1, L4). `/box` is the product
 * noun and the plan reserves the whole subtree under it — marketing,
 * dashboard, `/box/pricing`, and the install front door at `/box/install`
 * (stability rule 3). `box.tsx` is a sibling of `install.ts` under it, not a
 * parent of a directory: there is one screen here today, the same shape
 * `settings.tsx` and `settings.tsx`'s neighbours use.
 *
 * The install script this surface advertises is served at `/box/install`
 * beside this route — see `src/routes/box/install.ts`.
 */
export const Route = createFileRoute("/box")({
  head: () => ({ meta: [{ title: "Cafaye Box · Cafaye" }] }),
  component: Box,
});

function Box() {
  return <BoxPage />;
}
