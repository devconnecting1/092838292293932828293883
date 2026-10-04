import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"
import { SettingsNavSkeleton } from "@/components/shared/settings-nav"

export default function PerfilLoading() {
  return (
    <PageShell
      variant="settings"
      aria-busy="true"
      nav={<SettingsNavSkeleton />}
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      }
      rail={
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
        </Card>
      }
    >
      {[0, 1].map((card) => (
        <Card key={card}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </PageShell>
  )
}
