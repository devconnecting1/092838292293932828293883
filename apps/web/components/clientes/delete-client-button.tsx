"use client"

import { useRouter } from "next/navigation"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import { deleteClientRecord } from "@/lib/clientes/actions"
import { CLIENTS_PATH } from "@/lib/clientes/constants"

export function DeleteClientButton({ clientId }: { clientId: string }) {
  const router = useRouter()

  return (
    <ConfirmDeleteButton
      action={() => deleteClientRecord(clientId)}
      label="Excluir"
      showLabel
      title="Excluir este cliente?"
      description="O cliente sai das listas e buscas e fica na lixeira por 30 dias (dono e gerente restauram em Configurações > Lixeira). Depois é apagado de vez, com histórico e documentos — ou, se tiver proposta aceita, comissão ou autorização assinada, os dados pessoais são anonimizados e o que a lei obriga fica guardado."
      confirmLabel="Excluir cliente"
      onDone={() => router.push(CLIENTS_PATH)}
    />
  )
}
