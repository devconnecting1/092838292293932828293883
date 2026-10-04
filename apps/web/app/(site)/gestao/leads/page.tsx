import type { Metadata } from "next"

import { GestaoShell, LeadsGestao } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Leads", robots: { index: false } }

export default function LeadsPage() {
  return (
    <GestaoShell ativo="/gestao/leads">
      <LeadsGestao />
    </GestaoShell>
  )
}
