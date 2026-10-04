"use client"

import * as React from "react"

import { logLeadView } from "@/lib/leads/actions"

/**
 * Registra a abertura do detalhe do lead (LGPD) uma vez por montagem. Fica no
 * cliente para não gerar um registro a cada revalidação da página após
 * mutações (mesmo padrão de `components/clientes/client-view-logger.tsx`).
 */
export function LeadViewLogger({ leadId }: { leadId: string }) {
  const loggedLeadRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (loggedLeadRef.current === leadId) {
      return
    }

    loggedLeadRef.current = leadId
    void logLeadView(leadId)
  }, [leadId])

  return null
}
