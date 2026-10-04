import type { Metadata } from "next"

import { ClientesGestao, GestaoShell } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Clientes", robots: { index: false } }

export default function ClientesPage() {
  return (
    <GestaoShell ativo="/gestao/clientes">
      <ClientesGestao />
    </GestaoShell>
  )
}
