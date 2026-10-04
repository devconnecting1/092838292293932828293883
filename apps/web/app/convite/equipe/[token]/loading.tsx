import { Card, CardContent, CardFooter, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

export default function ConviteEquipeLoading() {
  return (
    <>
      <header className="flex items-center gap-4 p-4 md:px-10 md:py-6">
        <Skeleton className="h-6 w-40" />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-10 md:items-center" aria-busy="true">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
          <CardFooter className="gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </CardFooter>
        </Card>
      </main>
    </>
  )
}
