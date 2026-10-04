import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function PrevisaoSettingsLoading() {
  return (
    <PageShell
      variant="settings"
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      }
    >
      <Skeleton className="h-24 w-full" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-5 @min-[40rem]/page:grid-cols-3">
            {[0, 1, 2].map((field) => (
              <Skeleton key={field} className="h-16 w-full" />
            ))}
          </div>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </PageShell>
  )
}
