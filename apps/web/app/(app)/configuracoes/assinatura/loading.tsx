import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function AssinaturaLoading() {
  return (
    <PageShell
      variant="settings"
      width="wide"
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      }
    >
      <div className="grid gap-6 @min-[40rem]/main:grid-cols-2 @min-[72rem]/main:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <Card
            key={card}
            className={
              card === 2 ? "@min-[40rem]/main:col-span-2 @min-[72rem]/main:col-span-1" : undefined
            }
          >
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-40" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    </PageShell>
  )
}
