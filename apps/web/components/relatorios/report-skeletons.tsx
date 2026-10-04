import { Skeleton } from "@workspace/ui/components/skeleton"

import type { ReportTab } from "@/lib/relatorios/url"

/** Esqueleto do conteúdo de uma aba enquanto o banco soma os números. */
export function ReportTabSkeleton({ tab }: { tab: ReportTab }) {
  if (tab === "metas") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando as metas…</span>
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="grid gap-4 @2xl/page:grid-cols-2 @6xl/page:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (tab === "previsao") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando a previsão…</span>
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="grid gap-4 @2xl/page:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Carregando o relatório…</span>
      <Skeleton className="h-96 w-full rounded-xl" />
      {tab === "corretores" ? <Skeleton className="h-48 w-full rounded-xl" /> : null}
    </div>
  )
}
