import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState, Panel } from "@/components/ui";

type Dep = { name: string; ok: boolean };
type Status = { status: string; deps: Dep[] };

export default function StatusPage() {
  const query = useQuery<Status>({
    queryKey: ["status"],
    queryFn: async () => {
      const res = await fetch("/readyz", { cache: "no-store" });
      if (!res.ok) throw new Error("not ready");
      return res.json();
    },
    refetchInterval: 10_000,
  });

  if (query.isPending) return <LoadingState label="Checking services…" />;
  if (query.isError) return <ErrorState title="Status unavailable" detail="Could not read readiness." onRetry={() => { void query.refetch(); }} />;

  const data = query.data;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">parlor</p>
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
        <p className="text-sm text-muted">
          Readiness of every dependency this deployment has, polled every 10 seconds.
        </p>
      </header>
      <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
        {data.deps.length === 0 ? (
          <EmptyState title="No dependencies probed" />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.deps.map((dep) => (
              <li key={dep.name} className="flex items-center justify-between text-sm">
                <span className="font-medium">{dep.name}</span>
                <span className={dep.ok ? "text-green-600" : "text-red-600"}>
                  {dep.ok ? "ready" : "not ready"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
