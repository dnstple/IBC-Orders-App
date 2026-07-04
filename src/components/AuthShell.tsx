/**
 * Shared frame for the login / request-access pages: calm, premium,
 * closer to Shopify admin than a kitchen screen.
 */
export function AuthShell({ children, footnote }: { children: React.ReactNode; footnote?: string }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10">
      {/* soft brand wash */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-cocoa-100/70 to-transparent" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cocoa-700 text-xl font-semibold tracking-tight text-cream shadow-md">
            IB
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-cocoa-900">Italian Bear Chocolate</h1>
          <p className="mt-0.5 text-sm uppercase tracking-[0.2em] text-cocoa-500">Order Operations</p>
        </div>
        <div className="rounded-2xl border border-cocoa-100 bg-white p-8 shadow-[0_8px_30px_rgba(43,29,18,0.06)]">
          {children}
        </div>
        {footnote && <p className="mt-6 text-center text-xs text-stone-400">{footnote}</p>}
      </div>
    </main>
  );
}

export function AuthField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <input
        {...props}
        className="mt-1.5 w-full rounded-xl border border-stone-200 bg-stone-50/50 px-3.5 py-3 text-[15px] outline-none transition placeholder:text-stone-300 focus:border-cocoa-500 focus:bg-white focus:ring-2 focus:ring-cocoa-100"
      />
    </label>
  );
}

export function AuthButton({ busy, children }: { busy?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-2 min-h-12 w-full rounded-xl bg-cocoa-700 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-cocoa-600 active:scale-[0.99] disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-100">{children}</p>;
}
