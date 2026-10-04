import { SearchXIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default function CaptarNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Empty className="max-w-lg border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Imobiliária não encontrada</EmptyTitle>
          <EmptyDescription>
            O endereço deste formulário não existe ou mudou. Confira o link com a imobiliária.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
