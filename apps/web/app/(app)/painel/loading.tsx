import { Skeleton } from "@workspace/ui/components/skeleton"

export default function PainelLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o painel"
      className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6"
    >
      <div className="flex flex-col gap-2 px-4 lg:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @4xl/main:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-xl @4xl/main:col-span-2" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  )
}
