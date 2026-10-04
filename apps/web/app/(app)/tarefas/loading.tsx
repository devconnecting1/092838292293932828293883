import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

function TaskGroupSkeleton({ rows }: { rows: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-start gap-3 px-3">
            <Skeleton className="mt-0.5 size-4" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="size-7" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function TarefasLoading() {
  return (
    <PageShell aria-busy="true">
      <span className="sr-only">Carregando tarefas…</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <TaskGroupSkeleton rows={2} />
        <TaskGroupSkeleton rows={3} />
      </div>
    </PageShell>
  )
}
