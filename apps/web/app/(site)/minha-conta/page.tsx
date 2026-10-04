import type { Metadata } from "next"

import { MinhaConta } from "@/components/portal/minha-conta"

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } }

export default function MinhaContaPage() {
  return <MinhaConta />
}
