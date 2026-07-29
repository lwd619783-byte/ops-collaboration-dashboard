import type { PropsWithChildren } from 'react'

export function AppLayout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center px-4 sm:px-6">
          <span className="text-lg font-semibold tracking-tight">
            运维协同看板
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-sm text-slate-500 sm:px-6">
          运维协同看板 · 工程基线 v0.1
        </div>
      </footer>
    </div>
  )
}
