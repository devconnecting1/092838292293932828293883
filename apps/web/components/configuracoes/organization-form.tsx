"use client"

import * as React from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { useForm } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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

import { updateOrganizationData } from "@/app/(app)/configuracoes/imobiliaria/actions"
import { FormStateSelect, FormTextField } from "@/components/configuracoes/form-fields"
import { maskCnpj, maskPhoneBr } from "@/lib/configuracoes/masks"
import { organizationDataSchema, type OrganizationDataValues } from "@/lib/configuracoes/schemas"

type OrganizationFormProps = {
  defaultValues: OrganizationDataValues
  /** Só o dono edita; os demais papéis veem os campos somente leitura. */
  canEdit: boolean
  slug: string
  planLabel: string
  /** Página da assinatura; sem ela, orienta a falar com o suporte. */
  planHref?: string
}

export function OrganizationForm({
  defaultValues,
  canEdit,
  slug,
  planLabel,
  planHref,
}: OrganizationFormProps) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<OrganizationDataValues>({
    resolver: zodResolver(organizationDataSchema),
    mode: "onTouched",
    defaultValues,
  })

  function onSubmit(values: OrganizationDataValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await updateOrganizationData(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Dados salvos.", type: "success" })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof OrganizationDataValues, {
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
          <FieldLegend>Identificação</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormTextField
              control={form.control}
              name="name"
              id="org-nome"
              label="Nome da imobiliária"
              autoComplete="organization"
              readOnly={!canEdit}
            />
            <FormTextField
              control={form.control}
              name="legalName"
              id="org-razao-social"
              label="Razão social"
              readOnly={!canEdit}
            />
            <FormTextField
              control={form.control}
              name="cnpj"
              id="org-cnpj"
              label="CNPJ"
              placeholder="00.000.000/0000-00"
              autoComplete="off"
              mask={maskCnpj}
              readOnly={!canEdit}
              description="Aceita o formato numérico e o alfanumérico."
            />
            <FormTextField
              control={form.control}
              name="creci"
              id="org-creci"
              label="CRECI jurídico"
              placeholder="Ex.: J-12345"
              autoComplete="off"
              readOnly={!canEdit}
            />
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Contato e localização</FieldLegend>
          <FieldDescription>
            E-mail e telefone também vão no cabeçalho do feed dos portais.
          </FieldDescription>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormTextField
              control={form.control}
              name="phone"
              id="org-telefone"
              label="Telefone"
              type="tel"
              inputMode="tel"
              placeholder="(00) 00000-0000"
              autoComplete="tel"
              mask={maskPhoneBr}
              readOnly={!canEdit}
            />
            <FormTextField
              control={form.control}
              name="email"
              id="org-email"
              label="E-mail"
              type="email"
              placeholder="contato@imobiliaria.com.br"
              autoComplete="email"
              readOnly={!canEdit}
            />
            <FormTextField
              control={form.control}
              name="city"
              id="org-cidade"
              label="Cidade"
              autoComplete="address-level2"
              readOnly={!canEdit}
            />
            <FormStateSelect
              control={form.control}
              name="state"
              id="org-uf"
              label="UF"
              disabled={!canEdit}
            />
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Link público e plano</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="org-slug">Link da imobiliária</FieldLabel>
              <Input id="org-slug" value={slug} readOnly spellCheck={false} />
              <FieldDescription>
                Compõe os links públicos: formulário de captação e feed dos portais. Não muda aqui
                para não quebrar links já divulgados.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="org-plano">Plano</FieldLabel>
              <Input id="org-plano" value={planLabel} readOnly />
              <FieldDescription>
                {planHref ? (
                  <>
                    Uso, troca de plano e pagamento ficam na{" "}
                    <Link href={planHref}>página de assinatura</Link>.
                  </>
                ) : (
                  "Para mudar de plano, fale com o suporte."
                )}
              </FieldDescription>
            </Field>
          </div>
        </FieldSet>

        {canEdit ? (
          <Field orientation="horizontal" className="justify-end">
            <Button type="submit" disabled={isPending || !form.formState.isDirty}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Salvar alterações
            </Button>
          </Field>
        ) : null}
      </FieldGroup>
    </form>
  )
}
