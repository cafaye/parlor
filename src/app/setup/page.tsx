import { SetupScreen } from "./setup-screen";

export default function SetupPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Cafaye</p>
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="text-sm text-muted">
          A guided walk from a fresh account to running services.
        </p>
      </header>
      <SetupScreen />
    </main>
  );
}
