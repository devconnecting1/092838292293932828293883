import type { Metadata } from "next"

import { GestaoShell, PainelGestao } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Gestão", robots: { index: false } }

export default function GestaoPage() {
  return (
    <GestaoShell ativo="/gestao">
      <PainelGestao />
    </GestaoShell>
  )
}
