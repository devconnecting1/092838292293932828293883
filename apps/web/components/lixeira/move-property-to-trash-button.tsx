"use client"

import { useRouter } from "next/navigation"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import { moveToTrash } from "@/lib/lixeira/actions"

/** "Excluir" na ficha do imóvel (dono e gerente): vai para a lixeira por 30 dias. */
export function MovePropertyToTrashButton({ propertyId }: { propertyId: string }) {
  const router = useRouter()

  return (
    <ConfirmDeleteButton
      action={() => moveToTrash("property", propertyId)}
      label="Excluir"
      showLabel
      title="Excluir este imóvel?"
      description="O imóvel sai das listas, dos portais, do sitemap e da página pública e fica na lixeira por 30 dias (dono e gerente restauram em Configurações > Lixeira). Depois é apagado de vez, com fotos e documentos — ou, se tiver proposta aceita, comissão, autorização assinada ou documento no dossiê, só fotos, descrição e endereço são apagados e o que a lei obriga fica guardado."
      confirmLabel="Mover para a lixeira"
      onDone={() => router.push("/imoveis")}
    />
  )
}
