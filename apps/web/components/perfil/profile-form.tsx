"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { useForm, useWatch } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { updateProfile } from "@/app/(app)/perfil/actions"
import { CreciStatusBadge } from "@/components/configuracoes/creci-status-badge"
import { FormStateSelect, FormTextField } from "@/components/configuracoes/form-fields"
import { getInitials } from "@/components/crm/utils"
import { isHttpsUrl } from "@/lib/configuracoes/brand"
import { maskPhoneBr } from "@/lib/configuracoes/masks"
import { profileSchema, type ProfileValues } from "@/lib/configuracoes/schemas"

export function ProfileForm({
  defaultValues,
  email,
  today,
}: {
  defaultValues: ProfileValues
  email: string | null
  /** Hoje em Brasília (AAAA-MM-DD), calculado no servidor. */
  today: string
}) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: "onTouched",
    defaultValues,
  })

  const [fullName, avatarUrl, creciValidUntil] = useWatch({
    control: form.control,
    name: ["fullName", "avatarUrl", "creciValidUntil"],
  })
  const avatarPreview = avatarUrl && isHttpsUrl(avatarUrl) ? avatarUrl : undefined

  function onSubmit(values: ProfileValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await updateProfile(values)

      if (result.ok) {
        toast.add({
          title: result.message ?? "Perfil atualizado.",
          type: "success",
        })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof ProfileValues, {
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
          <FieldLegend>Dados pessoais</FieldLegend>
          <Field orientation="horizontal">
            <Avatar className="size-14">
              <AvatarImage src={avatarPreview} alt="" />
              <AvatarFallback>{getInitials(fullName || email)}</AvatarFallback>
            </Avatar>
            <FieldDescription>
              Sua foto e seu nome aparecem para a equipe das imobiliárias em que você trabalha.
            </FieldDescription>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormTextField
              control={form.control}
              name="fullName"
              id="perfil-nome"
              label="Nome completo"
              autoComplete="name"
            />
            <Field>
              <FieldLabel htmlFor="perfil-email">E-mail</FieldLabel>
              <Input id="perfil-email" value={email ?? ""} readOnly />
              <FieldDescription>
                É o e-mail com que você entra e o usado nos convites.
              </FieldDescription>
            </Field>
            <FormTextField
              control={form.control}
              name="phone"
              id="perfil-telefone"
              label="Telefone"
              type="tel"
              inputMode="tel"
              placeholder="(00) 00000-0000"
              autoComplete="tel"
              mask={maskPhoneBr}
            />
            <FormTextField
              control={form.control}
              name="avatarUrl"
              id="perfil-foto"
              label="URL da foto"
              type="url"
              inputMode="url"
              placeholder="https://..."
              autoComplete="off"
              description="Endereço público (https) de uma imagem."
            />
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>CRECI</FieldLegend>
          <FieldDescription>
            Não há consulta nacional automática: confira os dados com o seu conselho regional.
          </FieldDescription>
          <div className="grid gap-5 sm:grid-cols-3">
            <FormTextField
              control={form.control}
              name="creciNumber"
              id="perfil-creci"
              label="Número"
              placeholder="Ex.: 123456-F"
              autoComplete="off"
            />
            <FormStateSelect
              control={form.control}
              name="creciState"
              id="perfil-creci-uf"
              label="UF"
              allowEmpty
            />
            <FormTextField
              control={form.control}
              name="creciValidUntil"
              id="perfil-creci-validade"
              label="Validade"
              type="date"
            />
          </div>
          <CreciStatusBadge validUntil={creciValidUntil} today={today} />
        </FieldSet>

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar perfil
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
