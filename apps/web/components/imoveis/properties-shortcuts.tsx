"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { PROPERTY_SEARCH_INPUT_ID, shouldIgnoreShortcut } from "@/lib/imoveis/list-shortcuts"

/**
 * Atalhos da lista de imóveis: `/` põe o foco na busca e `N` abre o cadastro.
 *
 * Só valem com o foco fora de campos de texto e sem janela modal aberta, então
 * não atrapalham quem digita nem quem navega por teclado. Os dois aparecem na
 * tela (Kbd no campo de busca e no botão) e em `aria-keyshortcuts`.
 */
export function PropertiesShortcuts({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreShortcut(event)) return

      if (event.key === "/") {
        const input = document.getElementById(PROPERTY_SEARCH_INPUT_ID)
        if (!(input instanceof HTMLInputElement)) return
        event.preventDefault()
        input.focus()
        input.select()
        return
      }

      if (canCreate && (event.key === "n" || event.key === "N")) {
        event.preventDefault()
        router.push("/imoveis/novo")
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canCreate, router])

  return null
}
