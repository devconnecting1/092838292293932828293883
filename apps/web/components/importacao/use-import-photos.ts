"use client"

import * as React from "react"

import { processImportPhotos, type ImportPhotoStatus } from "@/lib/importacao/actions"

export type PhotoRunState =
  | { status: "idle" }
  | { status: "running"; progress: ImportPhotoStatus | null }
  | { status: "failed"; error: string; progress: ImportPhotoStatus | null }
  | { status: "finished"; progress: ImportPhotoStatus }

const NETWORK_ERROR =
  "A conexão caiu enquanto as fotos eram baixadas. As que já entraram estão salvas: tente de novo para continuar."

/** Chama o servidor em lotes pequenos até não sobrar link de foto pendente. */
export function useImportPhotos() {
  const [state, setState] = React.useState<PhotoRunState>({ status: "idle" })
  const runningRef = React.useRef(false)

  const run = React.useCallback(async (jobId: string): Promise<PhotoRunState> => {
    if (runningRef.current) {
      return { status: "idle" }
    }

    runningRef.current = true
    let progress: ImportPhotoStatus | null = null
    setState({ status: "running", progress })

    try {
      // Cada chamada baixa poucos links; o teto evita laço infinito se algo travar.
      for (let step = 0; step < 2_000; step += 1) {
        let result: Awaited<ReturnType<typeof processImportPhotos>> | null = null

        for (let attempt = 0; attempt < 3 && result === null; attempt += 1) {
          try {
            result = await processImportPhotos({ jobId })
          } catch {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000 * (attempt + 1)))
          }
        }

        if (result === null || !result.ok) {
          const failed: PhotoRunState = {
            status: "failed",
            error: result === null ? NETWORK_ERROR : result.error,
            progress,
          }
          setState(failed)
          return failed
        }

        progress = result.data
        setState({ status: "running", progress })

        if (progress.pending === 0) {
          const finished: PhotoRunState = { status: "finished", progress }
          setState(finished)
          return finished
        }
      }

      const stopped: PhotoRunState = { status: "failed", error: NETWORK_ERROR, progress }
      setState(stopped)
      return stopped
    } finally {
      runningRef.current = false
    }
  }, [])

  return { state, run }
}
