"use client"

import * as React from "react"

import {
  loadWhatsappComposerData,
  type WhatsappComposerData,
} from "@/lib/whatsapp-templates/actions"

/** Valor do seletor para o texto pronto do sistema (sem modelo da imobiliária). */
export const DEFAULT_WHATSAPP_TEMPLATE = "padrao"

type ReadyComposerData = Extract<WhatsappComposerData, { ok: true }>

/**
 * Modelos de mensagem, nome de quem envia e link público do imóvel, buscados
 * quando o diálogo de WhatsApp abre (chame `load` no onOpenChange). Falha na
 * busca não impede a conversa: fica só o texto pronto.
 */
export function useWhatsappComposer(propertyId: string | null | undefined) {
  const [data, setData] = React.useState<ReadyComposerData | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [isLoading, startLoading] = React.useTransition()

  function load() {
    startLoading(async () => {
      const result = await loadWhatsappComposerData(propertyId ?? null)

      if (result.ok) {
        setData(result)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })
  }

  return { data, failed, isLoading, load }
}
