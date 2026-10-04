"use client"

import * as React from "react"
import Link from "next/link"
import { CircleAlertIcon, InfoIcon, PencilIcon } from "lucide-react"

import type { PropertyStatus } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { formatDateTime } from "@/lib/format"
import { setPublishedToPortalsAction } from "@/lib/imoveis/property-actions"

/** Publicação no feed VRSync: só imóvel ativo e sem erros de validação. */
export function PortalPublishCard({
  propertyId,
  status,
  published,
  publishedAt,
  canEdit,
  errors,
  warnings,
  restricted = false,
  offAirByAuthorization = false,
}: {
  propertyId: string
  status: PropertyStatus
  published: boolean
  publishedAt: string | null
  canEdit: boolean
  errors: string[]
  warnings: string[]
  /** Imóvel restrito (sigilo) nunca vai para os portais. */
  restricted?: boolean
  /** Publicado, mas fora do arquivo por falta de autorização vigente. */
  offAirByAuthorization?: boolean
}) {
  const [isPending, startTransition] = React.useTransition()
  const [optimisticPublished, setOptimisticPublished] = React.useOptimistic(published)

  const isActive = status === "active"
  const isValid = errors.length === 0
  // Despublicar é sempre possível para quem edita; publicar exige ativo + VRSync válido.
  const disabled =
    isPending || !canEdit || (!optimisticPublished && !(isActive && isValid && !restricted))

  let description: string
  if (optimisticPublished && offAirByAuthorization) {
    description =
      "Fora do arquivo para os portais: sem autorização vigente. Volta ao registrar a renovação."
  } else if (optimisticPublished) {
    description = publishedAt
      ? `Publicado desde ${formatDateTime(publishedAt)}.`
      : "Publicado no arquivo para os portais."
  } else if (restricted) {
    description = "Imóvel restrito não vai para os portais."
  } else if (!isActive) {
    description = "Ative o imóvel para enviar no arquivo para os portais."
  } else if (!isValid) {
    description = "Corrija as pendências para publicar."
  } else {
    description = canEdit
      ? "Pronto para enviar no arquivo para os portais."
      : "Não publicado nos portais."
  }

  function handleCheckedChange(checked: boolean) {
    startTransition(async () => {
      setOptimisticPublished(checked)
      const result = await setPublishedToPortalsAction(propertyId, checked)

      if (result.ok) {
        toast.add({
          title: result.message ?? "Publicação atualizada.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível atualizar a publicação",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  const showIssues = !restricted && (errors.length > 0 || warnings.length > 0)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Portais imobiliários</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Switch
            checked={optimisticPublished}
            onCheckedChange={handleCheckedChange}
            disabled={disabled}
            aria-label="Publicar nos portais"
          />
        </CardAction>
      </CardHeader>
      {showIssues ? (
        <CardContent className="flex flex-col gap-3">
          {errors.length > 0 ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Pendências para os portais</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 ps-4">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {warnings.length > 0 ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Recomendações</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 ps-4">
                  {warnings.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {canEdit && errors.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/imoveis/${propertyId}/editar?etapa=portais`} />}
              nativeButton={false}
            >
              <PencilIcon data-icon="inline-start" />
              Corrigir no cadastro
            </Button>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}
