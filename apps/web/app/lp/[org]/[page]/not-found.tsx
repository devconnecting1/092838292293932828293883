import { SearchXIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default function LandingPageNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Empty className="max-w-lg border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Página não encontrada</EmptyTitle>
          <EmptyDescription>
            Esta oferta não está mais no ar ou o endereço mudou. Confira o link com a imobiliária ou
            fale com ela pelos canais de atendimento.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
