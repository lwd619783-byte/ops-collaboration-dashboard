export function HomePage() {
  return (
    <section className="max-w-3xl space-y-6">
      <div className="space-y-3">
        <p className="text-sm font-medium text-sky-700">项目基础页面</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          运维协同看板
        </h1>
        <p className="text-base leading-7 text-slate-600 sm:text-lg">
          用于运维项目的任务布置、进度记录、阻塞跟踪和任务验收。
        </p>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">工程状态</h2>
        <p className="mt-1 text-emerald-800">工程基线已就绪。</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
        <h2 className="font-semibold text-slate-900">后续功能</h2>
        <p className="mt-1 leading-6">
          项目管理、任务协同、进度更新和提醒能力将通过后续独立任务逐步建设。
        </p>
      </div>
    </section>
  )
}
