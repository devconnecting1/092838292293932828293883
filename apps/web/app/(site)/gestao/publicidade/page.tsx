import type { Metadata } from "next"

import { GestaoShell } from "@/components/portal/gestao"
import { PublicidadeGestao } from "@/components/portal/publicidade"

export const metadata: Metadata = { title: "Publicidade", robots: { index: false } }

export default function PublicidadeGestaoPage() {
  return (
    <GestaoShell ativo="/gestao/publicidade">
      <PublicidadeGestao />
    </GestaoShell>
  )
}
