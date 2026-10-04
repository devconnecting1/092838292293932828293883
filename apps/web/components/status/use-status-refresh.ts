"use client"

import * as React from "react"

import type { PublicStatusSnapshot } from "@workspace/core/status/public"
import { parsePublicStatusSnapshot } from "@workspace/core/status/snapshot"

import { getOverallSummary, parseStatusDate } from "@/components/status/format"
import { STATUS_API_PATH } from "@/components/status/links"
import { createStatusPoller, type StatusPollerEnvironment } from "@/components/status/status-poller"

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
  "focus",
] as const

export type StatusRefreshState = {
  snapshot: PublicStatusSnapshot | null
  /** A última tentativa falhou (a tela mantém o último retrato bom). */
  failed: boolean
  /** Atualização automática parada por inatividade. */
  paused: boolean
  /** Texto para o aria-live: só muda quando a situação muda ou a busca falha. */
  announcement: string
  refreshNow: () => void
}

function describeForAnnouncement(snapshot: PublicStatusSnapshot) {
  return `${getOverallSummary(snapshot).title}|${snapshot.activeIncidents
    .map((incident) => `${incident.id}:${incident.status}:${incident.updates.length}`)
    .join(",")}`
}

const browserEnvironment: StatusPollerEnvironment = {
  now: () => Date.now(),
  isVisible: () => document.visibilityState === "visible",
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  onActivity(listener) {
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, listener, { passive: true })
    }

    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, listener)
      }
    }
  },
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener)
    return () => document.removeEventListener("visibilitychange", listener)
  },
}

/**
 * Busca /api/status a cada 60 s só com a aba visível (Page Visibility API),
 * pausa depois de 30 min sem interação e retoma ao voltar (ver status-poller).
 * Nada de re-render quando a resposta não mudou; resposta fora do formato
 * conta como falha.
 */
export function useStatusRefresh(
  initialSnapshot: PublicStatusSnapshot | null,
  enabled: boolean
): StatusRefreshState {
  const [snapshot, setSnapshot] = React.useState(initialSnapshot)
  const [failed, setFailed] = React.useState(false)
  const [paused, setPaused] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const refreshNowRef = React.useRef<() => void>(() => {})

  React.useEffect(() => {
    if (!enabled) {
      return
    }

    let lastFailed = false
    let lastBody: string | null = null
    let lastDescription = initialSnapshot ? describeForAnnouncement(initialSnapshot) : null

    async function load(signal: AbortSignal) {
      try {
        const response = await fetch(STATUS_API_PATH, {
          signal,
          headers: { accept: "application/json" },
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const body = await response.text()
        const parsed = parsePublicStatusSnapshot(JSON.parse(body))

        if (!parsed) {
          throw new Error("resposta fora do formato")
        }

        if (signal.aborted) {
          return
        }

        if (lastFailed) {
          lastFailed = false
          setFailed(false)
        }

        if (body !== lastBody) {
          lastBody = body
          setSnapshot(parsed)

          const description = describeForAnnouncement(parsed)

          if (description !== lastDescription) {
            lastDescription = description
            setAnnouncement(`Situação atualizada: ${getOverallSummary(parsed).title}.`)
          }
        }
      } catch {
        if (signal.aborted) {
          return
        }

        if (!lastFailed) {
          lastFailed = true
          setFailed(true)
          setAnnouncement("Não foi possível atualizar a situação agora.")
        }
      }
    }

    const poller = createStatusPoller({
      env: browserEnvironment,
      initialGeneratedAt: initialSnapshot
        ? (parseStatusDate(initialSnapshot.generatedAt)?.getTime() ?? null)
        : null,
      load,
      onPausedChange: setPaused,
    })

    refreshNowRef.current = poller.refreshNow
    poller.start()

    return () => {
      poller.stop()
      refreshNowRef.current = () => {}
    }
  }, [enabled, initialSnapshot])

  const refreshNow = React.useCallback(() => refreshNowRef.current(), [])

  return { snapshot, failed, paused, announcement, refreshNow }
}
