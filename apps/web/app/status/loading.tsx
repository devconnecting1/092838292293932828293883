import { Card, CardContent } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

/** Esqueleto da página de status (título, faixa geral e partes do sistema). */
export default function StatusLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only">Carregando a situação do sistema…</span>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Card>
          <CardContent className="flex flex-col gap-6">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
