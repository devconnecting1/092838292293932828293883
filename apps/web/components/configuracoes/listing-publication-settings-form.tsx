"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm, type Control } from "react-hook-form"

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
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { saveListingPublicationSettingsAction } from "@/lib/imoveis/listing-publication-actions"
import {
  listingPublicationSettingsSchema,
  type ListingPublicationSettingsValues,
} from "@/lib/imoveis/listing-publication-schema"

type SwitchName = "hideWithoutValidAuthorization" | "publicPagesEnabledByDefault"

function SwitchField({
  control,
  name,
  id,
  label,
  description,
  disabled,
}: {
  control: Control<ListingPublicationSettingsValues>
  name: SwitchName
  id: string
  label: string
  description: string
  disabled: boolean
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal" data-disabled={disabled || undefined}>
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <FieldDescription>{description}</FieldDescription>
          </FieldContent>
          <Switch
            id={id}
            checked={field.value}
            onCheckedChange={field.onChange}
            disabled={disabled}
          />
        </Field>
      )}
    />
  )
}

/**
 * Regras de publicação dos anúncios: retirada automática sem autorização
 * vigente, padrão da página pública e medição (Meta Pixel e tag do Google) da
 * página pública do imóvel. Só dono e gerente editam.
 */
export function ListingPublicationSettingsForm({
  defaultValues,
  canEdit,
}: {
  defaultValues: ListingPublicationSettingsValues
  canEdit: boolean
}) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<ListingPublicationSettingsValues>({
    resolver: zodResolver(listingPublicationSettingsSchema),
    mode: "onTouched",
    defaultValues,
  })
  const disabled = !canEdit || isPending

  function onSubmit(values: ListingPublicationSettingsValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await saveListingPublicationSettingsAction(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Regras salvas.", type: "success" })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof ListingPublicationSettingsValues, {
            type: "server",
            message,
          })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <FieldSet>
          <FieldLegend>Anúncios</FieldLegend>
          <SwitchField
            control={form.control}
            name="hideWithoutValidAuthorization"
            id="publicacao-autorizacao"
            label="Tirar do ar anúncio sem autorização vigente"
            description="Imóvel com autorização vencida (ou que ainda não começou) sai do arquivo dos portais, da página pública, das landing pages e do Google. Volta sozinho ao registrar a renovação. Imóvel sem autorização cadastrada não é afetado."
            disabled={disabled}
          />
          <SwitchField
            control={form.control}
            name="publicPagesEnabledByDefault"
            id="publicacao-pagina-padrao"
            label="Página pública ligada por padrão"
            description="Vale para os imóveis ativos sem escolha própria. Em cada imóvel dá para ligar ou desligar a página. Imóvel restrito nunca tem página."
            disabled={disabled}
          />
        </FieldSet>

        <FieldSet>
          <FieldLegend>Medição na página pública do imóvel</FieldLegend>
          <FieldDescription>
            Os scripts oficiais só carregam depois que o visitante aceita os cookies de medição.
            Contêiner do Google Tag Manager não é aceito.
          </FieldDescription>
          <Controller
            control={form.control}
            name="metaPixelId"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="publicacao-meta-pixel">ID do Meta Pixel</FieldLabel>
                <Input
                  id="publicacao-meta-pixel"
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={20}
                  placeholder="123456789012345"
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value.replace(/\D/g, ""))}
                />
                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Só os números, no Gerenciador de Eventos da Meta. Pode ser o mesmo das landing
                    pages.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="googleTagId"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="publicacao-google-tag">ID da tag do Google (GA4)</FieldLabel>
                <Input
                  id="publicacao-google-tag"
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={33}
                  placeholder="G-XXXXXXXXXX"
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={field.onBlur}
                  onChange={(event) =>
                    field.onChange(event.target.value.replace(/\s/g, "").toUpperCase())
                  }
                />
                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    ID de medição do Google Analytics 4 (G-) ou do Google Ads (AW-).
                  </FieldDescription>
                )}
              </Field>
            )}
          />
        </FieldSet>

        {canEdit ? (
          <Field orientation="horizontal" className="justify-end">
            <Button type="submit" disabled={isPending || !form.formState.isDirty}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Salvar regras
            </Button>
          </Field>
        ) : null}
      </FieldGroup>
    </form>
  )
}
