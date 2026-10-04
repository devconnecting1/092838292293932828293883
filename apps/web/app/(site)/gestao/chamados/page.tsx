import type { Metadata } from "next"

import { Chamados, GestaoShell } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Chamados", robots: { index: false } }

export default function ChamadosPage() {
  return (
    <GestaoShell ativo="/gestao/chamados">
      <Chamados equipe />
    </GestaoShell>
  )
}
