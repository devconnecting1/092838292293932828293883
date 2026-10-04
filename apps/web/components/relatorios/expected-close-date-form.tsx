"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { DatePicker } from "@/components/agenda/date-picker"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { setProposalExpectedCloseDate } from "@/lib/relatorios/actions"

/**
 * Preenche a data prevista de fechamento direto da aba Previsão. Quem pode é a
 * mesma regra de editar a proposta (o banco confere no UPDATE).
 */
export function ExpectedCloseDateForm({
  proposalId,
  proposalLabel,
  initialDate,
}: {
  proposalId: string
  proposalLabel: string
  initialDate: string | null
}) {
  const [date, setDate] = React.useState(initialDate ?? "")
  const { isPending, run } = useGuardedSubmit()
  const changed = date !== "" && date !== (initialDate ?? "")

  function save() {
    if (!changed) return

    run(
      async () => {
        const result = await setProposalExpectedCloseDate(proposalId, date)

        if (!result.ok) {
          toast.add({
            title: "Não foi possível salvar a data",
            description: result.error,
            type: "error",
          })
          return
        }

        toast.add({ title: result.message ?? "Data prevista salva.", type: "success" })
      },
      ({ message }) =>
        toast.add({ title: "Não foi possível salvar a data", description: message, type: "error" })
    )
  }

  const inputId = `data-prevista-${proposalId}`

  return (
    <div className="flex w-full items-center gap-2 @2xl/page:w-auto">
      <label htmlFor={inputId} className="sr-only">
        Data prevista de fechamento de {proposalLabel}
      </label>
      <div className="min-w-0 flex-1 @2xl/page:w-44 @2xl/page:flex-none">
        <DatePicker
          id={inputId}
          value={date}
          onChange={setDate}
          placeholder="Data prevista"
          disabled={isPending}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant={changed ? "default" : "outline"}
        disabled={!changed || isPending}
        onClick={save}
      >
        {isPending ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
        Salvar
      </Button>
    </div>
  )
}
