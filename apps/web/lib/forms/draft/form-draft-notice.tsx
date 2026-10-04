"use client"

import { HistoryIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

import type { FormDraftControls } from "@/lib/forms/draft/use-form-draft"

type FormDraftNoticeProps = {
  draft: Pick<FormDraftControls, "offer" | "restore" | "discard">
  /** Complemento do texto (ex.: quais campos não voltam). */
  note?: string
  className?: string
}

/** "Encontramos um rascunho de DD/MM às HH:MM — Recuperar | Descartar". */
export function FormDraftNotice({ draft, note, className }: FormDraftNoticeProps) {
  if (!draft.offer) return null

  return (
    <Alert className={className}>
      <HistoryIcon />
      <AlertTitle>Encontramos um rascunho de {draft.offer.savedAtLabel}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>
          Ele ficou guardado só neste navegador e ainda não foi salvo.{note ? ` ${note}` : null}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={draft.restore}>
            Recuperar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={draft.discard}>
            Descartar
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}
