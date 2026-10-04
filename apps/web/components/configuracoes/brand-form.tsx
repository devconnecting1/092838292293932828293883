"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { updateOrganizationBrand } from "@/app/(app)/configuracoes/imobiliaria/actions"
import { FormTextField } from "@/components/configuracoes/form-fields"
import { getInitials } from "@/components/crm/utils"
import { HEX_COLOR_PATTERN, isHttpsUrl } from "@/lib/configuracoes/brand"
import { brandSchema, type BrandValues } from "@/lib/configuracoes/schemas"

const COLOR_PICKER_FALLBACK = "#000000"

export function BrandForm({
  defaultValues,
  canEdit,
  organizationName,
}: {
  defaultValues: BrandValues
  canEdit: boolean
  organizationName: string
}) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<BrandValues>({
    resolver: zodResolver(brandSchema),
    mode: "onTouched",
    defaultValues,
  })

  const logoUrl = useWatch({ control: form.control, name: "logoUrl" })
  const logoPreview = logoUrl && isHttpsUrl(logoUrl) ? logoUrl : undefined

  function onSubmit(values: BrandValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await updateOrganizationBrand(values)

      if (result.ok) {
        toast.add({
          title: result.message ?? "Marca atualizada.",
          type: "success",
        })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof BrandValues, { type: "server", message })
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

        <Controller
          name="primaryColor"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="marca-cor">Cor principal</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  aria-label="Escolher a cor principal"
                  className="w-12 shrink-0 p-1"
                  value={HEX_COLOR_PATTERN.test(field.value) ? field.value : COLOR_PICKER_FALLBACK}
                  onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                  onBlur={field.onBlur}
                  disabled={!canEdit}
                />
                <Input
                  id="marca-cor"
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value.trim().toUpperCase())}
                  placeholder="#0C6B63"
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  readOnly={!canEdit}
                  aria-invalid={fieldState.invalid}
                />
              </div>
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>
                  Hexadecimal, como #0C6B63. Em branco, o formulário público usa a cor padrão do
                  CRM.
                </FieldDescription>
              )}
            </Field>
          )}
        />

        <FormTextField
          control={form.control}
          name="logoUrl"
          id="marca-logo"
          label="URL do logo"
          type="url"
          inputMode="url"
          placeholder="https://www.suaimobiliaria.com.br/logo.png"
          autoComplete="off"
          readOnly={!canEdit}
          description="Endereço público (https) de uma imagem PNG, JPG ou SVG. O envio de arquivo chega numa próxima versão."
        />

        <Field orientation="horizontal">
          <Avatar className="size-12">
            <AvatarImage src={logoPreview} alt="" />
            <AvatarFallback>{getInitials(organizationName)}</AvatarFallback>
          </Avatar>
          <FieldDescription>
            {logoPreview
              ? "Prévia do logo. Se a imagem não aparecer, confira se o endereço é público."
              : "Sem logo: mostramos as iniciais da imobiliária."}
          </FieldDescription>
        </Field>

        {canEdit ? (
          <Field orientation="horizontal" className="justify-end">
            <Button type="submit" disabled={isPending || !form.formState.isDirty}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Salvar marca
            </Button>
          </Field>
        ) : null}
      </FieldGroup>
    </form>
  )
}
