import Link from "next/link"
import { UserXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { CLIENTS_PATH } from "@/lib/clientes/constants"

export default function ClienteNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-4 lg:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserXIcon />
          </EmptyMedia>
          <EmptyTitle>Cliente não encontrado</EmptyTitle>
          <EmptyDescription>
            O cliente não existe, foi removido ou não está disponível para você nesta imobiliária.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={CLIENTS_PATH} />} nativeButton={false}>
            Voltar aos clientes
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
