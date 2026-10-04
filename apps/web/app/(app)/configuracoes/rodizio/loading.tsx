import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function RodizioLoading() {
  return (
    <PageShell
      variant="settings"
      width="wide"
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      }
    >
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-80 max-w-full" />
              </div>
              <Skeleton className="h-5 w-10" />
            </div>
          ))}
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((stat) => (
              <Skeleton key={stat} className="h-14 w-full" />
            ))}
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="hidden h-5 w-16 sm:block" />
              <Skeleton className="hidden h-5 w-32 md:block" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    </PageShell>
  )
}
