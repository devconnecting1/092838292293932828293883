import type { Metadata } from "next"

import { PlatformHealthPage } from "@/components/plataforma/platform-health-page"

export const metadata: Metadata = {
  title: "Saúde do sistema",
}

/** /plataforma abre direto na Saúde do sistema (mesma tela de /plataforma/saude). */
export default function PlatformConsoleHomePage() {
  return <PlatformHealthPage />
}
