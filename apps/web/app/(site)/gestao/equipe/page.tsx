import type { Metadata } from "next"

import { EquipeGestao, GestaoShell } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Equipe", robots: { index: false } }

export default function EquipePage() {
  return (
    <GestaoShell ativo="/gestao/equipe">
      <EquipeGestao />
    </GestaoShell>
  )
}
