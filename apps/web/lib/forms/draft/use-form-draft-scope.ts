"use client"

import * as React from "react"

import type { FormDraftScope } from "@workspace/core/forms/draft"

import { getFormDraftScopeAction } from "@/lib/forms/draft/scope-action"

type PartialScope = {
  userId?: string | null
  organizationId?: string | null
}

/**
 * Escopo do rascunho (usuário + imobiliária). Usa o que veio por prop; se
 * faltar algum id, pergunta ao servidor uma vez por montagem. Enquanto não
 * resolve (ou sem conexão), devolve null e o formulário segue sem rascunho.
 * Com `enabled` false (ex.: só leitura), não pergunta nada.
 */
export function useFormDraftScope(
  explicit?: PartialScope | null,
  enabled = true
): FormDraftScope | null {
  const userId = explicit?.userId ?? null
  const organizationId = explicit?.organizationId ?? null
  const needsServer = enabled && !(userId && organizationId)
  const [resolved, setResolved] = React.useState<FormDraftScope | null>(null)

  React.useEffect(() => {
    if (!needsServer) return

    let active = true

    getFormDraftScopeAction()
      .then((scope) => {
        if (active) setResolved(scope)
      })
      .catch(() => {
        // Sem conexão agora: o formulário funciona, só não guarda rascunho.
      })

    return () => {
      active = false
    }
  }, [needsServer])

  return React.useMemo(() => {
    if (!enabled) return null
    if (userId && organizationId) return { userId, organizationId }
    return resolved
  }, [enabled, userId, organizationId, resolved])
}
