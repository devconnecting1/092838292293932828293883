import { Card, CardContent, CardFooter, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

/** Cartões por coluna do quadro, das primeiras etapas (mais cheias) às últimas. */
const COLUMN_CARDS = [3, 2, 2, 1, 1]
const PHONE_CARDS = [0, 1, 2]
const SUMMARY_CARDS = [0, 1, 2, 3]

/**
 * O esqueleto não sabe a visão escolhida (`loading` não recebe o endereço), então
 * segue a do aparelho, no mesmo ponto de quebra da tela (640 px, o `sm`): lista
 * em cartões no celular e quadro em colunas a partir daí.
 */
export default function LeadsLoading() {
  return (
    <div aria-busy="true" className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-6">
      <span className="sr-only">Carregando leads…</span>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Resumo: grade 2×2 no celular (sem a explicação) e 4 colunas no computador. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <Skeleton key={card} className="h-20 w-full rounded-xl sm:h-28" />
        ))}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Skeleton className="h-8 w-full lg:w-48" />
        <Skeleton className="h-8 w-full lg:w-44" />
        <Skeleton className="h-8 w-full lg:w-44" />
        <Skeleton className="h-8 w-40 lg:ms-auto" />
      </div>

      {/* Celular: lista em cartões, no formato do cartão do lead. */}
      <div className="flex flex-col gap-3 sm:hidden">
        {PHONE_CARDS.map((card) => (
          <Card key={card} size="sm">
            <CardHeader>
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex gap-1">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <Skeleton className="h-11 w-full" />
            </CardContent>
            <CardFooter className="gap-2">
              <Skeleton className="h-11 flex-1" />
              <Skeleton className="h-11 flex-1" />
              <Skeleton className="h-11 flex-1" />
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* A partir de 640 px: colunas do quadro. */}
      <div className="flex gap-3 overflow-hidden max-sm:hidden">
        {COLUMN_CARDS.map((cards, column) => (
          <div
            key={column}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2"
          >
            <Skeleton className="h-7 w-32" />
            {Array.from({ length: cards }, (_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
