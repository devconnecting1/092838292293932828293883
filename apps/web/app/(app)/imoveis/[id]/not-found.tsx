import Link from "next/link"
import { ArrowLeftIcon, SearchXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default function PropertyNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-4 lg:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Imóvel não encontrado</EmptyTitle>
          <EmptyDescription>
            O imóvel pode ter sido removido, o link está incorreto ou ele pertence a outra
            imobiliária.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href="/imoveis" />} nativeButton={false}>
            <ArrowLeftIcon data-icon="inline-start" />
            Voltar para imóveis
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
