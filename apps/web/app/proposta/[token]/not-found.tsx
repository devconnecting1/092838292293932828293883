import { LinkIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** Mesma tela para link errado, revogado ou vencido: não revela qual é o caso. */
export default function PropostaPublicaNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Empty className="max-w-lg border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LinkIcon />
          </EmptyMedia>
          <EmptyTitle>Link da proposta indisponível</EmptyTitle>
          <EmptyDescription>
            Este endereço não vale mais: a proposta pode ter saído do ar ou o prazo do link pode ter
            passado. Peça um link novo ao corretor.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
