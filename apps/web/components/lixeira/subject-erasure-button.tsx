"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UserRoundXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { TypedConfirmDialog } from "@/components/lixeira/typed-confirm-dialog"
import { eraseSubjectData } from "@/lib/lixeira/actions"
import { ANONYMIZATION_SUMMARY, LEGAL_HOLD_EXPLANATION } from "@/lib/lixeira/constants"

type SubjectErasureButtonProps = {
  entity: "lead" | "client"
  recordId: string
  name: string
  onDone?: () => void
  /** Página para onde ir depois (a ficha deixa de existir). */
  redirectTo?: string
  size?: "sm" | "default"
}

/**
 * "Excluir dados a pedido do titular" (LGPD, art. 18), para dono e gerente.
 * O banco apaga na hora ou, com guarda legal, anonimiza, e grava o comprovante.
 */
export function SubjectErasureButton({
  entity,
  recordId,
  name,
  onDone,
  redirectTo,
  size = "default",
}: SubjectErasureButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button variant="ghost" size={size} onClick={() => setOpen(true)}>
        <UserRoundXIcon data-icon="inline-start" />
        Excluir dados a pedido do titular
      </Button>
      <TypedConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Excluir dados a pedido do titular?"
        expected={name}
        confirmLabel="Excluir dados"
        action={(typed) => eraseSubjectData(entity, recordId, typed)}
        onDone={() => {
          onDone?.()
          if (redirectTo) router.push(redirectTo)
        }}
      >
        <p>
          Use quando a própria pessoa pedir a exclusão dos dados dela (LGPD, art. 18). Não passa
          pela lixeira: é feito agora e não pode ser desfeito.
        </p>
        {entity === "lead" ? (
          <p>
            O lead é apagado com o histórico e as conversas de WhatsApp. Se ele já virou cliente, o
            cliente vinculado recebe o mesmo tratamento.
          </p>
        ) : (
          <p>
            Sem proposta aceita, comissão ou autorização assinada, o cliente é apagado com leads,
            histórico, conversas e documentos. Com algum desses vínculos, é anonimizado:{" "}
            {ANONYMIZATION_SUMMARY.client}
          </p>
        )}
        <p>{LEGAL_HOLD_EXPLANATION}</p>
        <p>
          Fica um comprovante sem os dados apagados (data, quem executou e o que foi feito) em
          Configurações &gt; Lixeira.
        </p>
      </TypedConfirmDialog>
    </>
  )
}
