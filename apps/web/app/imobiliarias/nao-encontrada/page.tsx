import type { Metadata } from "next"
import { notFound } from "next/navigation"

export const metadata: Metadata = {
  title: { absolute: "Imobiliária não encontrada" },
  robots: { index: false, follow: false },
}

/**
 * Destino interno do proxy para subdomínio desconhecido ou reservado. Responde
 * 404 com a tela de not-found.tsx, sem revelar dados.
 */
export default function ImobiliariaNaoEncontradaPage() {
  notFound()
}
