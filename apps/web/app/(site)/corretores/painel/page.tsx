import type { Metadata } from "next"

import { CorretorPainel } from "@/components/portal/corretor-painel"

export const metadata: Metadata = { title: "Painel do corretor", robots: { index: false } }

export default function PainelPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <CorretorPainel />
    </div>
  )
}
