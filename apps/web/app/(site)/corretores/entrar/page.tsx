import type { Metadata } from "next"

import { CorretorCadastro } from "@/components/portal/corretor-cadastro"

export const metadata: Metadata = { title: "Entrar na área do corretor", robots: { index: false } }

export default function EntrarCorretorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <CorretorCadastro modo="entrar" />
    </div>
  )
}
