import type { Metadata } from "next"

import { CorretorAprovacao } from "@/components/portal/corretor-aprovacao"

export const metadata: Metadata = { title: "Aprovar corretores", robots: { index: false } }

export default function AprovarPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <CorretorAprovacao />
    </div>
  )
}
