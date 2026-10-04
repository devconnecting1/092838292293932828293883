import Link from "next/link"
import { ArrowLeftIcon, BuildingIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export default function CondominioNotFound() {
  return (
    <div className="flex flex-1 flex-col p-4 lg:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BuildingIcon />
          </EmptyMedia>
          <EmptyTitle>Condomínio não encontrado</EmptyTitle>
          <EmptyDescription>
            O link pode estar incorreto, ou o condomínio foi excluído ou pertence a outra
            imobiliária.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href="/condominios" />} nativeButton={false}>
            <ArrowLeftIcon data-icon="inline-start" />
            Voltar para condomínios
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
