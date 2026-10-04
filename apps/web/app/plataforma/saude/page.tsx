import type { Metadata } from "next"

import { PlatformHealthPage } from "@/components/plataforma/platform-health-page"

export const metadata: Metadata = {
  title: "Saúde do sistema",
}

export default function PlatformHealthRoutePage() {
  return <PlatformHealthPage />
}
