"use client"

import * as React from "react"
import { unstable_rethrow } from "next/navigation"

import {
  classifySubmitError,
  submitFailureMessage,
  type SubmitFailureKind,
} from "@workspace/core/forms/submit-error"

export type SubmitFailure = {
  kind: SubmitFailureKind
  /** Texto pronto para a tela ("Sem conexão. Seus dados continuam aqui; …"). */
  message: string
}

export type GuardedSubmit = {
  /** Envio em andamento: desabilite o botão de salvar. */
  isPending: boolean
  /**
   * Roda a Server Action numa transição. Ignora cliques enquanto um envio está
   * em andamento (sem envio duplo) e transforma rejeição (queda de rede, erro
   * do servidor) em `onFailure`, sem derrubar a tela no error.tsx. Devolve
   * false quando o envio foi ignorado.
   */
  run: (task: () => Promise<void>, onFailure: (failure: SubmitFailure) => void) => boolean
}

function isBrowserOnline(): boolean | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.onLine
}

export function useGuardedSubmit(): GuardedSubmit {
  const [isPending, startTransition] = React.useTransition()
  const inFlightRef = React.useRef(false)

  const run = React.useCallback<GuardedSubmit["run"]>((task, onFailure) => {
    if (inFlightRef.current) return false

    inFlightRef.current = true

    startTransition(async () => {
      try {
        await task()
      } catch (error) {
        // redirect()/notFound() continuam com o Next.
        unstable_rethrow(error)
        const kind = classifySubmitError(error, { online: isBrowserOnline() })
        onFailure({ kind, message: submitFailureMessage(kind) })
      } finally {
        inFlightRef.current = false
      }
    })

    return true
  }, [])

  return { isPending, run }
}
