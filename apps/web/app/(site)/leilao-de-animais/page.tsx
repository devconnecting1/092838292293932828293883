import type { Metadata } from "next"

import { GuiaLeilaoBens } from "@/components/portal/guia-leilao-bens"
import { guiaPorSlug } from "@/lib/portal/leiloes-bens"

const guia = guiaPorSlug("leilao-de-animais")!

export const metadata: Metadata = {
  title: guia.titulo,
  description: guia.chamada,
}

export const revalidate = 300

export default function Page() {
  return <GuiaLeilaoBens guia={guia} />
}
