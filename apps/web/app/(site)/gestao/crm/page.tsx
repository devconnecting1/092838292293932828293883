import type { Metadata } from "next"

import { GestaoShell } from "@/components/portal/gestao"
import { MeuCrm } from "@/components/portal/meu-crm"

export const metadata: Metadata = { title: "Meu CRM", robots: { index: false } }

export default function CrmGestaoPage() {
  return (
    <GestaoShell ativo="/gestao/crm">
      <MeuCrm semClientes />
    </GestaoShell>
  )
}
