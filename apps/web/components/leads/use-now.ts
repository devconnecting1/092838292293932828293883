"use client"

import * as React from "react"

/**
 * Relógio que avança sozinho (cronômetros "sem contato há X min"). Começa no
 * instante calculado pelo servidor, para o HTML do servidor e do navegador baterem.
 */
export function useNow(initialNowMs: number, intervalMs = 15_000) {
  const [now, setNow] = React.useState(initialNowMs)

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}
