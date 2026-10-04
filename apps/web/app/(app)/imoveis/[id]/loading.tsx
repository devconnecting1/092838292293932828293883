import { Skeleton } from "@workspace/ui/components/skeleton"

const TAB_PLACEHOLDERS = [0, 1, 2, 3, 4, 5]

export default function PropertyDetailLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando imóvel…</span>
      <Skeleton className="h-7 w-24" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Skeleton className="aspect-4/3 w-full shrink-0 sm:w-48" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-7 w-40" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 lg:justify-end">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>

      <div className="flex gap-2 overflow-hidden">
        {TAB_PLACEHOLDERS.map((index) => (
          <Skeleton key={index} className="h-8 w-28 shrink-0" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  )
}
