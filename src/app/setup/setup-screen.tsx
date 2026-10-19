import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Link } from "@tanstack/react-router";

import { Button, Callout, LoadingState, Surface } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePantry } from "@/lib/pantry-context";

/**
 * `/setup` — the guided setup flow.
 *
 * A checklist that walks a visitor from "no account" to "running services",
 * reusing the screens that already exist (box enrollment, email providers,
 * DNS verification, billing plans). The "choose services" card at the bottom
 * reads the pantry catalog so the list of available cafaye services comes
 * from the registry rather than from a hardcoded copy.
 */
export function SetupScreen() {
  const { token } = useAuth();
  const pantry = usePantry();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const catalog = useQuery({
    queryKey: ["pantry", "projects", token ?? ""],
    queryFn: () => pantry.listProjects(token, {}),
    retry: false,
  });

  const projects = catalog.data?.data ?? [];

  function toggle(name: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Surface as="section" padding="pane">
        <h2 className="text-base font-medium">Setup checklist</h2>
        <ol className="mt-3 flex flex-col gap-2 text-sm">
          <li>
            <Link className="font-medium underline underline-offset-2" to="/register">
              Create your account
            </Link>{" "}
            <span className="text-muted">— or sign in if you already have one.</span>
          </li>
          <li>
            <Link className="font-medium underline underline-offset-2" to="/box">
              Choose hosted or your own box
            </Link>{" "}
            <span className="text-muted">— both end with the same services running.</span>
          </li>
          <li>
            <Link className="font-medium underline underline-offset-2" to="/billing/plans">
              Pick a plan
            </Link>{" "}
            <span className="text-muted">— if you are using the hosted path.</span>
          </li>
        </ol>
      </Surface>

      <Surface as="section" padding="pane">
        <h2 className="text-base font-medium">Choose services</h2>
        <p className="mt-1 text-sm text-muted">
          Services come from the cafaye registry. Tick the ones you want configured.
        </p>
        {catalog.isLoading ? <LoadingState className="mt-4" label="Loading services…" /> : null}
        {catalog.isError ? (
          <Callout className="mt-4" tone="caution">
            The service catalog is not available right now. You can still follow the checklist
            above.
          </Callout>
        ) : null}
        {projects.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {projects.map((project) => (
              <li className="flex items-start gap-2" key={project.name}>
                <input
                  checked={selected.has(project.name)}
                  className="mt-1"
                  id={`svc-${project.name}`}
                  onChange={() => toggle(project.name)}
                  type="checkbox"
                />
                <label className="text-sm" htmlFor={`svc-${project.name}`}>
                  <span className="font-medium">{project.name}</span>
                  {project.description ? (
                    <span className="text-muted"> — {project.description}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {selected.size > 0 ? (
          <p className="mt-4 text-xs text-muted">
            Selected: {Array.from(selected).join(", ")}
          </p>
        ) : null}
      </Surface>

      <div className="flex justify-end">
        <Button type="button">Save selection</Button>
      </div>
    </div>
  );
}
