import { createFileRoute } from "@tanstack/react-router";

import StatusPage from "@/app/status/page";

export const Route = createFileRoute("/status")({
  component: StatusPage,
});
