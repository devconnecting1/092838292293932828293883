import { Skeleton } from "@workspace/ui/components/skeleton"

export default function CondominioLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6" aria-busy="true">
      <span className="sr-only">Carregando condomínio…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-32" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-72 max-w-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-36 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
