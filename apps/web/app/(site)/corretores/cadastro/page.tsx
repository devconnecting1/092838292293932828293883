import type { Metadata } from "next"

import { CorretorCadastro } from "@/components/portal/corretor-cadastro"

export const metadata: Metadata = {
  title: "Cadastro de corretor",
  description: "Crie sua conta de corretor com CRECI e envie os documentos do Selo Verde.",
}

export default function CadastroPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <CorretorCadastro modo="cadastro" />
    </div>
  )
}
