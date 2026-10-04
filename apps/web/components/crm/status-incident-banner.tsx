import type { ComponentProps } from "react"
import { ActivityIcon, WrenchIcon } from "lucide-react"

import type { IncidentImpact } from "@workspace/core/status/public"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { getActiveIncidentHeadline } from "@/components/status/format"
import { getStatusPageHref } from "@/components/status/links"
import { getPublicStatus } from "@/lib/status/public"

/** Do menor para o maior, para achar o pior impacto entre os incidentes abertos. */
const IMPACT_ORDER: readonly IncidentImpact[] = ["none", "minor", "major", "critical"]

/**
 * Impacto do incidente -> gravidade da faixa. Só o crítico ganha fundo cheio, e
 * é o único da casca do CRM que ganha: é a faixa que precisa parar o corretor.
 */
const IMPACT_VARIANTS: Record<IncidentImpact, ComponentProps<typeof Alert>["variant"]> = {
  none: "default",
  minor: "warning",
  major: "destructive",
  critical: "critical",
}

async function loadSnapshot() {
  try {
    return await getPublicStatus()
  } catch (cause) {
    console.error(
      `[crm] status público indisponível para a faixa (${cause instanceof Error ? cause.name : "erro"})`
    )
    return null
  }
}

/**
 * Faixa discreta no topo do CRM enquanto há incidente ou manutenção em
 * andamento, com link para a página de status (nova aba). Sem retrato, com
 * falha ou sem nada em andamento, não renderiza nada: um aviso nunca derruba
 * a página. Usar dentro de <Suspense fallback={null}> no layout do CRM.
 */
export async function StatusIncidentBanner() {
  const snapshot = await loadSnapshot()
  const headline = snapshot ? getActiveIncidentHeadline(snapshot) : null

  if (!snapshot || !headline) {
    return null
  }

  const incidents = snapshot.activeIncidents.filter((incident) => incident.kind === "incident")
  const isMaintenanceOnly = incidents.length === 0
  const worstImpact = incidents.reduce<IncidentImpact>(
    (worst, incident) =>
      IMPACT_ORDER.indexOf(incident.impact) > IMPACT_ORDER.indexOf(worst) ? incident.impact : worst,
    "none"
  )
  const Icon = isMaintenanceOnly ? WrenchIcon : ActivityIcon

  return (
    <div className="px-4 pt-4 lg:px-6">
      <Alert
        variant={isMaintenanceOnly ? "maintenance" : IMPACT_VARIANTS[worstImpact]}
        role="status"
      >
        <Icon />
        <AlertTitle>{headline}</AlertTitle>
        <AlertDescription>
          <a href={getStatusPageHref()} target="_blank" rel="noopener">
            Acompanhe em Status do sistema
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        </AlertDescription>
      </Alert>
    </div>
  )
}
