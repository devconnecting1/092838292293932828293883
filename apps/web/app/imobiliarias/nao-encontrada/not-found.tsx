import { SearchXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { getAppOrigin } from "@/lib/tenant/urls"

export default function ImobiliariaNaoEncontrada() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Empty className="max-w-lg border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Imobiliária não encontrada</EmptyTitle>
          <EmptyDescription>
            Não existe imobiliária neste endereço. Confira se o link foi digitado corretamente.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<a href={getAppOrigin()} />} nativeButton={false}>
            Ir para a página inicial
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
