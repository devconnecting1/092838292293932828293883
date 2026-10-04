"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon, EyeIcon, SaveIcon } from "lucide-react"
import { useForm, useWatch, type FieldErrors } from "react-hook-form"

import { PROPERTY_STATUS_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { toast } from "@workspace/ui/components/toast"

import { StepCaracteristicas } from "@/components/imoveis/property-form/step-caracteristicas"
import { StepDados } from "@/components/imoveis/property-form/step-dados"
import { StepEndereco } from "@/components/imoveis/property-form/step-endereco"
import { StepMidia } from "@/components/imoveis/property-form/step-midia"
import { getPublishState, StepPortais } from "@/components/imoveis/property-form/step-portais"
import { StepValores } from "@/components/imoveis/property-form/step-valores"
import type {
  CaptureSummary,
  MemberOption,
  PropertySummary,
} from "@/components/imoveis/property-form/types"
import type { Role } from "@/lib/auth/roles"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useGuardedSubmit, type SubmitFailure } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"
import {
  findStepForField,
  PROPERTY_FORM_STEPS,
  type PropertyFormStepKey,
} from "@/lib/imoveis/form-steps"
import type { AuthorizationPeriod, MediaSource } from "@/lib/imoveis/mappers"
import { savePropertyAction } from "@/lib/imoveis/property-actions"
import type { CondominiumOption } from "@/lib/imoveis/queries"
import {
  getStatusRequirementIssues,
  propertyFormSchema,
  type PropertyFormField,
  type PropertyFormValues,
} from "@/lib/imoveis/schema"

type PropertyFormProps = {
  organizationId: string
  /** Usuário logado: separa o rascunho local por pessoa. */
  userId: string
  role: Role
  property: PropertySummary | null
  initialValues: PropertyFormValues
  initialStep: PropertyFormStepKey
  media: MediaSource[]
  authorizations: AuthorizationPeriod[]
  members: MemberOption[]
  condominiums: CondominiumOption[]
  capture: CaptureSummary | null
  canDeleteMedia: boolean
  /** Assinatura em modo leitura: o envio de fotos fica bloqueado. */
  uploadsBlocked?: boolean
}

const ALL_FIELDS = PROPERTY_FORM_STEPS.flatMap((step) => [...step.fields]) as PropertyFormField[]

/**
 * Cadastro de imóvel em etapas. Um único formulário (as etapas ficam montadas)
 * salvo por completo a qualquer momento; como rascunho não há exigências além
 * do título.
 */
export function PropertyForm({
  organizationId,
  userId,
  role,
  property,
  initialValues,
  initialStep,
  media,
  authorizations,
  members,
  condominiums,
  capture,
  canDeleteMedia,
  uploadsBlocked = false,
}: PropertyFormProps) {
  const router = useRouter()
  const [step, setStep] = React.useState<PropertyFormStepKey>(initialStep)
  const [formError, setFormError] = React.useState<string | null>(null)
  const { isPending: isSaving, run: runSave } = useGuardedSubmit()

  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    mode: "onTouched",
    defaultValues: initialValues,
  })

  // Rascunho local por usuário + imobiliária + imóvel (ou cadastro novo).
  const draft = useFormDraft({
    form,
    scope: { userId, organizationId },
    formId: "imovel",
    recordId: property?.id ?? null,
  })

  const status = useWatch({ control: form.control, name: "status" })
  const { errors, isDirty } = form.formState
  const stepIndex = PROPERTY_FORM_STEPS.findIndex((item) => item.key === step)
  const previousStep = PROPERTY_FORM_STEPS[stepIndex - 1]
  const nextStep = PROPERTY_FORM_STEPS[stepIndex + 1]

  // Queda de rede ou erro inesperado: a tela e os campos ficam como estão.
  function onSaveFailure({ message }: SubmitFailure) {
    draft.saveNow()
    setFormError(message)
    toast.add({ type: "error", title: "Não foi possível salvar", description: message })
  }

  function submit(values: PropertyFormValues) {
    setFormError(null)
    const publishState = getPublishState(values, property, media)

    if (values.status !== "draft") {
      const issues = getStatusRequirementIssues(publishState.columns)
      const firstIssue = issues[0]
      if (firstIssue) {
        for (const issue of issues) {
          form.setError(issue.field, { type: "manual", message: issue.message })
        }
        setStep(findStepForField(firstIssue.field))
        setFormError(
          `Para salvar como "${PROPERTY_STATUS_LABELS[values.status]}", complete: ${issues
            .map((issue) => issue.message.replace(/\.$/, "").toLowerCase())
            .join("; ")}. Ou salve como rascunho.`
        )
        return
      }
    }

    const payload: PropertyFormValues = {
      ...values,
      publishedToPortals: values.publishedToPortals && publishState.canPublish,
    }

    runSave(async () => {
      const result = await savePropertyAction({
        values: payload,
        propertyId: property?.id ?? null,
        captureRequestId: property ? null : (capture?.id ?? null),
      })

      if (!result.ok) {
        let firstField: string | null = null
        for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
          if (!message) continue
          form.setError(field as PropertyFormField, { type: "server", message })
          firstField ??= field
        }
        if (firstField) setStep(findStepForField(firstField))
        setFormError(result.error)
        toast.add({
          type: "error",
          title: "Não foi possível salvar",
          description: result.error,
        })
        return
      }

      draft.clear()
      toast.add({
        type: "success",
        title: result.message,
        description:
          result.imobScore != null ? `Nota do Anúncio: ${result.imobScore}/100.` : undefined,
      })
      for (const warning of result.warnings) {
        toast.add({ type: "warning", title: "Atenção", description: warning })
      }

      if (result.created) {
        router.replace(`/imoveis/${result.propertyId}/editar?etapa=midia`)
      } else {
        form.reset(payload)
      }
    }, onSaveFailure)
  }

  function onInvalid(fieldErrors: FieldErrors<PropertyFormValues>) {
    const firstField = ALL_FIELDS.find((field) => fieldErrors[field])
    if (firstField) setStep(findStepForField(firstField))
    setFormError("Confira os campos destacados.")
  }

  const handleSubmit = form.handleSubmit(submit, onInvalid)

  function saveDraft() {
    form.setValue("status", "draft")
    void handleSubmit()
  }

  function renderStep(key: PropertyFormStepKey) {
    switch (key) {
      case "dados":
        return (
          <StepDados
            control={form.control}
            members={members}
            condominiums={condominiums}
            role={role}
            capture={property ? null : capture}
          />
        )
      case "valores":
        return <StepValores control={form.control} />
      case "endereco":
        return <StepEndereco control={form.control} setValue={form.setValue} />
      case "caracteristicas":
        return <StepCaracteristicas control={form.control} />
      case "midia":
        return (
          <StepMidia
            control={form.control}
            organizationId={organizationId}
            property={property}
            media={media}
            canDeleteMedia={canDeleteMedia}
            uploadsBlocked={uploadsBlocked}
            isSaving={isSaving}
            onSaveDraft={saveDraft}
          />
        )
      case "portais":
        return (
          <StepPortais
            control={form.control}
            property={property}
            media={media}
            authorizations={authorizations}
            onGoToStep={setStep}
            role={role}
            userId={userId}
            savedAssignment={
              property
                ? {
                    captured_by: initialValues.capturedBy || null,
                    broker_id: initialValues.brokerId || null,
                  }
                : null
            }
          />
        )
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={isDirty} />
      <FormDraftNotice draft={draft} />
      {formError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não foi possível salvar</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={step}
        onValueChange={(value) => setStep(value as PropertyFormStepKey)}
        className="gap-4"
      >
        <TabsList
          aria-label="Etapas do cadastro"
          className="max-w-full justify-start overflow-x-auto"
        >
          {PROPERTY_FORM_STEPS.map((item, index) => {
            const hasError = item.fields.some((field) => errors[field])
            return (
              <TabsTrigger key={item.key} value={item.key} className="flex-none">
                <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                {item.title}
                {hasError ? (
                  <>
                    <CircleAlertIcon className="text-destructive" aria-hidden="true" />
                    <span className="sr-only">(com pendências)</span>
                  </>
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {PROPERTY_FORM_STEPS.map((item) => (
          <TabsContent key={item.key} value={item.key} keepMounted>
            <Card>
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>{renderStep(item.key)}</CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!previousStep}
            onClick={() => previousStep && setStep(previousStep.key)}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Anterior</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!nextStep}
            onClick={() => nextStep && setStep(nextStep.key)}
          >
            <span className="hidden sm:inline">Próximo</span>
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {isDirty ? (
            <span className="hidden text-xs text-muted-foreground md:inline">
              Alterações não salvas
            </span>
          ) : null}
          {property ? (
            <Button
              variant="ghost"
              render={<Link href={`/imoveis/${property.id}`} />}
              nativeButton={false}
            >
              <EyeIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Ver ficha</span>
            </Button>
          ) : null}
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {status === "draft" ? "Salvar rascunho" : "Salvar"}
          </Button>
        </div>
      </div>
    </form>
  )
}
