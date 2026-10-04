import type { Metadata } from "next"

import { ImportarImoveis } from "@/components/portal/importar-imoveis"

export const metadata: Metadata = { title: "Atualizar imóveis", robots: { index: false } }

export default function ImportarPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <ImportarImoveis />
    </div>
  )
}
