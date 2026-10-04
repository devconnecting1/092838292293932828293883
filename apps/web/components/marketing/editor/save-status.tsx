"use client"

import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import { formatTime } from "@/lib/format"

export type SaveStatusState =
  | { kind: "saved"; at: string | null }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "invalid"; sections: string[] }
  | { kind: "error"; message: string }
  | { kind: "readonly" }

/** Indicador do salvamento automático. */
export function SaveStatus({ state, onRetry }: { state: SaveStatusState; onRetry: () => void }) {
  switch (state.kind) {
    case "readonly":
      return <span className="text-sm text-muted-foreground">Somente leitura</span>
    case "saving":
      return (
        <span
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <Spinner />
          Salvando…
        </span>
      )
    case "pending":
      return (
        <span
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <CircleDashedIcon aria-hidden="true" className="size-4" />
          Alterações pendentes
        </span>
      )
    case "invalid":
      return (
        <span className="flex items-center gap-1.5 text-sm text-destructive" aria-live="polite">
          <CircleAlertIcon aria-hidden="true" className="size-4" />
          Corrija os campos em {state.sections.join(", ")}
        </span>
      )
    case "error":
      return (
        <span className="flex items-center gap-1 text-sm text-destructive" aria-live="polite">
          <Tooltip>
            <TooltipTrigger render={<span className="flex items-center gap-1.5" />}>
              <CircleAlertIcon aria-hidden="true" className="size-4" />
              Não foi possível salvar
            </TooltipTrigger>
            <TooltipContent>{state.message}</TooltipContent>
          </Tooltip>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRetry}>
            <RotateCcwIcon />
            <span className="sr-only">Tentar salvar de novo</span>
          </Button>
        </span>
      )
    case "saved":
      return (
        <span
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          {state.at ? `Salvo às ${formatTime(state.at)}` : "Tudo salvo"}
        </span>
      )
  }
}
