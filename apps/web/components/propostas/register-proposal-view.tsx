"use client"

import * as React from "react"

import { registerProposalView } from "@/app/proposta/[token]/actions"

/**
 * Marca no CRM que o cliente abriu a proposta ("saber se ele leu"). Roda uma
 * vez por montagem, no navegador de quem abriu — prévia de link do WhatsApp e
 * robôs, que não executam JavaScript, não contam como leitura.
 *
 * Não desenha nada e falha em silêncio: o registro é um extra para o corretor,
 * nunca um obstáculo para o cliente ler a proposta.
 */
export function RegisterProposalView({ token }: { token: string }) {
  const registered = React.useRef(false)

  React.useEffect(() => {
    if (registered.current) {
      return
    }

    registered.current = true
    void registerProposalView(token).catch(() => {})
  }, [token])

  return null
}
