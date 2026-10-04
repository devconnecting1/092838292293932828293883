import type { Metadata } from "next"

import { NovaSenha } from "@/components/portal/corretor-senha"

export const metadata: Metadata = { title: "Nova senha", robots: { index: false } }

export default function NovaSenhaPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <NovaSenha />
    </div>
  )
}
