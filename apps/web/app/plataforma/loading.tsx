import { Skeleton } from "@workspace/ui/components/skeleton"

/** Carregamento das telas do console (o layout já conferiu o acesso). */
export default function PlatformConsoleLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6" aria-busy="true">
      <span className="sr-only">Carregando...</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
