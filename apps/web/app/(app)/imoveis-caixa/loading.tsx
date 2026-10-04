import { Card, CardContent } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function ImoveisCaixaLoading() {
  return (
    <PageShell aria-busy="true" aria-label="Carregando imóveis da Caixa">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Card>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 2 }, (_, row) => (
            <div key={row} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-14" />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
      <Skeleton className="h-4 w-40" />
      <div className="grid grid-cols-1 gap-4 @min-[36rem]/page:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-xl p-2 ring-1 ring-foreground/10">
            <Skeleton className="aspect-video w-full" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-5 w-2/5" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}
