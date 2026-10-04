"use client"

import * as React from "react"

/** Abre a janela de impressão (salvar em PDF) quando a página é aberta com ?imprimir=1. */
export function ImprimirAuto() {
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("imprimir") === "1") {
      const t = setTimeout(() => window.print(), 800)
      return () => clearTimeout(t)
    }
  }, [])
  return null
}
