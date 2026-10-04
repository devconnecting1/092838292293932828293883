"use client"

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default function LandingPageError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Empty className="max-w-lg border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Não foi possível abrir esta página</EmptyTitle>
          <EmptyDescription>
            Pode ser uma instabilidade momentânea. Tente de novo em instantes.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => retry()}>
            <RotateCwIcon data-icon="inline-start" />
            Tentar de novo
          </Button>
          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">Código: {error.digest}</p>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  )
}
