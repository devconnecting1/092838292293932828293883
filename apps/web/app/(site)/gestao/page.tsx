import type { Metadata } from "next"

import { CentralAlertas } from "@/components/portal/central-alertas"
import { GestaoShell, PainelGestao } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Gestão", robots: { index: false } }

export default function GestaoPage() {
  return (
    <GestaoShell ativo="/gestao">
      <div className="flex flex-col gap-6">
        <CentralAlertas />
        <PainelGestao />
      </div>
    </GestaoShell>
  )
}
