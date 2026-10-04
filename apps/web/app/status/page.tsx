import type { Metadata } from "next"

import type { PublicStatusSnapshot } from "@workspace/core/status/public"

import { APP_NAME } from "@/components/crm/brand"
import { StatusLive } from "@/components/status/status-live"
import { getPublicStatus } from "@/lib/status/public"

// Estática com ISR de 1 minuto (mesmo ritmo da checagem automática): cada
// visita não vira uma invocação. O navegador busca /api/status depois.
export const revalidate = 60

const DESCRIPTION = `Situação do ${APP_NAME} agora: partes do sistema, disponibilidade dos últimos 90 dias, incidentes e manutenções.`

export const metadata: Metadata = {
  // O template do layout raiz acrescenta "· APP_NAME"; o Open Graph não passa por ele.
  title: "Status do sistema",
  description: DESCRIPTION,
  openGraph: {
    title: `Status do sistema · ${APP_NAME}`,
    description: DESCRIPTION,
    type: "website",
    locale: "pt_BR",
  },
}

type StatusPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function loadSnapshot() {
  try {
    return await getPublicStatus()
  } catch (cause) {
    console.error(
      `[status] retrato público indisponível (${cause instanceof Error ? cause.name : "erro"})`
    )
    return null
  }
}

export default async function StatusPage({ searchParams }: StatusPageProps) {
  // Dados fictícios só em `next dev` e só com ?exemplo=ok|incidente|manutencao|sem-dados.
  // No build de produção este bloco é removido (NODE_ENV é substituído no build):
  // nem os exemplos nem a leitura da query string chegam a produção.
  if (process.env.NODE_ENV === "development") {
    const { exemplo } = await searchParams

    if (typeof exemplo === "string") {
      const { getStatusExample } = await import("@/components/status/fixtures")
      const example: PublicStatusSnapshot | null | undefined = getStatusExample(exemplo)

      if (example !== undefined) {
        return <StatusLive initialSnapshot={example} autoRefresh={false} isExample />
      }
    }
  }

  return <StatusLive initialSnapshot={await loadSnapshot()} />
}
