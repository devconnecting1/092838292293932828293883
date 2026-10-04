import type { Metadata } from "next"

import { ConfiguracoesGestao } from "@/components/portal/configuracoes"
import { GestaoShell } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Configurações", robots: { index: false } }

export default function ConfiguracoesPage() {
  return (
    <GestaoShell ativo="/gestao/configuracoes">
      <ConfiguracoesGestao />
    </GestaoShell>
  )
}
