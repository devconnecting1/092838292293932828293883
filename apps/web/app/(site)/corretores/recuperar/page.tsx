import type { Metadata } from "next"

import { RecuperarSenha } from "@/components/portal/corretor-senha"

export const metadata: Metadata = { title: "Recuperar senha", robots: { index: false } }

export default function RecuperarPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <RecuperarSenha />
    </div>
  )
}
