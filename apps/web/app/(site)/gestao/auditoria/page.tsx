import type { Metadata } from "next"

import { AuditoriaGestao, GestaoShell } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Auditoria", robots: { index: false } }

export default function AuditoriaPage() {
  return (
    <GestaoShell ativo="/gestao/auditoria">
      <AuditoriaGestao />
    </GestaoShell>
  )
}
