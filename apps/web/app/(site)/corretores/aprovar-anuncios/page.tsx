import type { Metadata } from "next"

import { VitrineAvulsos } from "@/components/portal/avulsos"

export const metadata: Metadata = { title: "Aprovar anúncios", robots: { index: false } }

export default function AprovarAnunciosPage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Aprovar anúncios de imóveis avulsos
      </h1>
      <p className="text-slate-600">Só o administrador vê esta fila (o banco confere).</p>
      <VitrineAvulsos admin />
    </div>
  )
}
