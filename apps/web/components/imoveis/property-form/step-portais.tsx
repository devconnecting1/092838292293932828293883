"use client"

import * as React from "react"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { Controller, useWatch } from "react-hook-form"

import { PROPERTY_STATUS_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"
import { Switch } from "@workspace/ui/components/switch"

import { ImobScoreCard } from "@/components/imoveis/imob-score-card"
import {
  fieldId,
  SelectField,
  type PropertyFormControl,
  type SelectOption,
} from "@/components/imoveis/property-form/fields"
import type { PropertySummary } from "@/components/imoveis/property-form/types"
import type { Role } from "@/lib/auth/roles"
import { PROPERTY_STATUSES } from "@/lib/imoveis/constants"
import {
  findStepForField,
  findStepForPortalIssue,
  type PropertyFormStepKey,
} from "@/lib/imoveis/form-steps"
import {
  computePropertyScore,
  summarizeMedia,
  validatePropertyForPortals,
  withExternalMediaUrls,
  type AuthorizationPeriod,
  type MediaSource,
} from "@/lib/imoveis/mappers"
import { canManageProperty, mustStayAssigned } from "@/lib/imoveis/permissions"
import {
  formValuesToColumns,
  getStatusRequirementIssues,
  type PropertyFormValues,
} from "@/lib/imoveis/schema"

const STATUS_ITEMS: SelectOption[] = PROPERTY_STATUSES.map((value) => ({
  label: PROPERTY_STATUS_LABELS[value],
  value,
}))

/** Regras para publicar: imóvel salvo, ativo e sem erros de VRSync. */
export function getPublishState(
  values: PropertyFormValues,
  property: PropertySummary | null,
  media: readonly MediaSource[]
) {
  const columns = formValuesToColumns(values)
  const mediaSummary = summarizeMedia(withExternalMediaUrls(media, values.videoUrl, values.tourUrl))
  const portal = validatePropertyForPortals(
    { ...columns, code: property?.code ?? "" },
    mediaSummary
  )
  const canPublish =
    property !== null && values.status === "active" && portal.valid && !values.isRestricted

  let reason = "Pronto para publicar."
  if (values.isRestricted) reason = "Imóvel restrito não vai para os portais."
  else if (!property) reason = "Salve o imóvel e envie as fotos antes de publicar."
  else if (values.status !== "active") reason = "Disponível só para imóveis com status Ativo."
  else if (!portal.valid) reason = "Corrija os itens abaixo para publicar."

  return { columns, mediaSummary, portal, canPublish, reason }
}

export function StepPortais({
  control,
  property,
  media,
  authorizations,
  onGoToStep,
  role,
  userId,
  savedAssignment,
}: {
  control: PropertyFormControl
  property: PropertySummary | null
  media: readonly MediaSource[]
  authorizations: readonly AuthorizationPeriod[]
  onGoToStep: (step: PropertyFormStepKey) => void
  role: Role
  userId: string
  /** Captador e corretor gravados no banco (null no cadastro). */
  savedAssignment: { captured_by: string | null; broker_id: string | null } | null
}) {
  const values = useWatch({ control }) as PropertyFormValues
  const { columns, mediaSummary, portal, canPublish, reason } = getPublishState(
    values,
    property,
    media
  )
  const statusIssues = getStatusRequirementIssues(columns)
  const score = computePropertyScore(columns, mediaSummary, authorizations)

  // Mesma regra do gatilho properties_guard_restricted: vale o captador e o
  // corretor já gravados; no cadastro, os do formulário (ou quem cadastra).
  const assignment = savedAssignment ?? {
    captured_by:
      values.capturedBy ||
      (mustStayAssigned(role) && !values.capturedBy && !values.brokerId ? userId : null),
    broker_id: values.brokerId || null,
  }
  const canChangeRestriction = canManageProperty(role, userId, assignment)

  return (
    <FieldGroup>
      <SelectField
        control={control}
        name="status"
        label="Status do anúncio"
        items={STATUS_ITEMS}
        description="Rascunho não vai para os portais e não exige preço nem área. Os demais status exigem."
      />

      {statusIssues.length > 0 ? (
        <Alert variant={values.status === "draft" ? "default" : "destructive"}>
          {values.status === "draft" ? <InfoIcon /> : <TriangleAlertIcon />}
          <AlertTitle>
            {values.status === "draft"
              ? "Para ativar depois, falta:"
              : "Falta completar para sair do rascunho:"}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-4">
              {statusIssues.map((issue) => (
                <li key={issue.field}>
                  {issue.message}{" "}
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => onGoToStep(findStepForField(issue.field))}
                  >
                    Ir para o campo
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Sigilo</FieldLegend>
        <Controller
          name="isRestricted"
          control={control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              data-invalid={fieldState.invalid || undefined}
              data-disabled={!canChangeRestriction || undefined}
            >
              <FieldContent>
                <FieldLabel htmlFor={fieldId("isRestricted")}>Imóvel restrito</FieldLabel>
                <FieldDescription>
                  {canChangeRestriction
                    ? "Só o dono, o gerente, o captador, o corretor responsável e as pessoas escolhidas na ficha veem o imóvel, os documentos e as propostas. Não vai para os portais nem para a página pública."
                    : "Só o dono, o gerente, o captador ou o corretor responsável mudam o sigilo."}
                </FieldDescription>
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </FieldContent>
              <Switch
                id={fieldId("isRestricted")}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked)}
                disabled={!canChangeRestriction}
              />
            </Field>
          )}
        />
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Publicação nos portais</FieldLegend>
        <FieldDescription>
          ZAP Imóveis, Viva Real e OLX recebem, pelo arquivo para os portais, os imóveis ativos com
          a publicação ligada.
        </FieldDescription>

        <Controller
          name="publishedToPortals"
          control={control}
          render={({ field }) => (
            <Field orientation="horizontal" data-disabled={!canPublish || undefined}>
              <FieldContent>
                <FieldLabel htmlFor={fieldId("publishedToPortals")}>
                  Publicar nos portais
                </FieldLabel>
                <FieldDescription>{reason}</FieldDescription>
              </FieldContent>
              <Switch
                id={fieldId("publishedToPortals")}
                checked={field.value && canPublish}
                onCheckedChange={(checked) => field.onChange(checked)}
                disabled={!canPublish}
              />
            </Field>
          )}
        />

        {portal.errors.length > 0 ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Pendências para os portais</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 ps-4">
                {portal.errors.map((issue) => (
                  <li key={`${issue.field}-${issue.message}`}>
                    {issue.message}{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={() => onGoToStep(findStepForPortalIssue(issue.field))}
                    >
                      Corrigir
                    </Button>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CircleCheckIcon />
            <AlertTitle>Anúncio dentro das regras dos portais</AlertTitle>
            <AlertDescription>
              Título, descrição, preço, área, endereço e fotos atendem aos portais.
            </AlertDescription>
          </Alert>
        )}

        {portal.warnings.length > 0 ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Recomendações</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 ps-4">
                {portal.warnings.map((issue) => (
                  <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldSet>

      <ImobScoreCard
        result={score}
        title="Prévia da Nota do Anúncio"
        description="Calculada com os dados do formulário; a nota oficial é recalculada e gravada ao salvar. Veja abaixo como melhorar a nota do anúncio."
      />
    </FieldGroup>
  )
}
