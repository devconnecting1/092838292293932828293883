import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function ConexoesLoading() {
  return (
    <PageShell
      variant="settings"
      width="wide"
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      }
    >
      <Skeleton className="h-20 w-full" />
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((card) => (
          <Card key={card}>
            <CardHeader>
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  )
}
