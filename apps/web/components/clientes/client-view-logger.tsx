"use client"

import * as React from "react"

import { logClientView } from "@/lib/clientes/actions"

/**
 * Registra a abertura da ficha (LGPD) uma vez por montagem. Fica no cliente
 * para não gerar um registro a cada revalidação da página após mutações.
 */
export function ClientViewLogger({ clientId }: { clientId: string }) {
  const loggedClientRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (loggedClientRef.current === clientId) {
      return
    }

    loggedClientRef.current = clientId
    void logClientView(clientId)
  }, [clientId])

  return null
}
