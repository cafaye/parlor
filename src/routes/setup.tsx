import { createFileRoute } from "@tanstack/react-router";

import SetupPage from "@/app/setup/page";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Setup · Cafaye" }] }),
  component: Setup,
});

function Setup() {
  return <SetupPage />;
}
