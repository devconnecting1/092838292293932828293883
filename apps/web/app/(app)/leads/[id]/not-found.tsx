import Link from "next/link"
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

import { LEADS_PATH } from "@/lib/leads/constants"

export default function LeadNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-4 lg:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Lead não encontrado</EmptyTitle>
          <EmptyDescription>
            O lead não existe, foi excluído ou não está disponível para você nesta imobiliária.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={LEADS_PATH} />} nativeButton={false}>
            Voltar ao funil
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
