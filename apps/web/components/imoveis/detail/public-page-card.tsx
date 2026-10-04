"use client"

import * as React from "react"

import type { ListingPublication } from "@workspace/core/properties/listing-publication"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { setPublicPageEnabledAction } from "@/lib/imoveis/listing-publication-actions"

type PublicPageState = ListingPublication["publicPage"]

function describe(state: PublicPageState, enabled: boolean, restricted: boolean) {
  if (restricted) return "Imóvel restrito não tem página pública."
  if (!enabled) {
    return state.followsDefault
      ? "Desligada pelo padrão da imobiliária. Ligue para publicar a página deste imóvel."
      : "Desligada: sem endereço público e fora do Google. A equipe continua vendo o imóvel."
  }
  if (state.reason === "inactive") return "Ligada. Fica no ar quando o imóvel estiver ativo."
  if (state.reason === "authorization") {
    return "Fora do ar: sem autorização vigente. Volta ao registrar a renovação."
  }

  return state.followsDefault
    ? "No ar e no Google, pelo padrão da imobiliária."
    : "No ar e no Google."
}

/**
 * Chave "Página pública" do imóvel. A página respeita o sigilo (restrito nunca
 * tem página) e sai do ar com autorização vencida, com a chave ligada ou não.
 */
export function PublicPageCard({
  propertyId,
  state,
  canEdit,
  restricted,
}: {
  propertyId: string
  state: PublicPageState
  canEdit: boolean
  restricted: boolean
}) {
  const [isPending, startTransition] = React.useTransition()
  const [optimisticEnabled, setOptimisticEnabled] = React.useOptimistic(state.enabled)

  // Restrito: a página não existe, então a chave fica travada (o sigilo manda).
  const disabled = isPending || !canEdit || restricted

  function handleCheckedChange(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked)
      const result = await setPublicPageEnabledAction(propertyId, checked)

      if (result.ok) {
        toast.add({ title: result.message ?? "Página pública atualizada.", type: "success" })
      } else {
        toast.add({
          title: "Não foi possível alterar a página pública",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Página pública</CardTitle>
        <CardDescription>{describe(state, optimisticEnabled, restricted)}</CardDescription>
        <CardAction>
          <Switch
            checked={optimisticEnabled && !restricted}
            onCheckedChange={handleCheckedChange}
            disabled={disabled}
            aria-label="Página pública do imóvel"
          />
        </CardAction>
      </CardHeader>
    </Card>
  )
}
