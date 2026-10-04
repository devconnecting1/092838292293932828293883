"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { BuildingIcon, CircleAlertIcon, SearchIcon, UserIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { finishTenantSlugInput, sanitizeTenantSlugInput } from "@workspace/core/tenant/slug"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { createOrganization, lookupCnpj } from "@/app/onboarding/actions"
import {
  BRAZILIAN_STATES,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
  organizationSchema,
  SLUG_MAX_LENGTH,
  slugify,
  type OrganizationKind,
  type OrganizationValues,
} from "@/app/onboarding/schema"
import type { TenantLinkPreview } from "@/lib/tenant/urls"

const STATE_ITEMS = [
  { label: "Selecione", value: null },
  ...BRAZILIAN_STATES.map((state) => ({
    label: `${state.code} · ${state.name}`,
    value: state.code,
  })),
]

type LookupFeedback = {
  type: "success" | "warning" | "error"
  message: string
} | null

/** Cidade e UF que a última consulta de CNPJ preencheu (para não apagar o que a pessoa digitou). */
type LookupLocation = { city: string | null; state: string | null }

/** A consulta só troca o valor se o campo está vazio ou ainda tem o que ela mesma preencheu. */
function canReplaceWithLookup(current: string, lastFilled: string | null) {
  return current.trim() === "" || current === lastFilled
}

export function OnboardingForm({
  linkPreview,
}: {
  /**
   * Link que o slug compõe, calculado no servidor para o modo atual:
   * https://{slug}.raiz (subdomain) ou https://site/captar/{slug} (host único).
   * `null` quando o host único não tem origem configurada.
   */
  linkPreview: TenantLinkPreview | null
}) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [isLookingUp, startLookup] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [lookupFeedback, setLookupFeedback] = React.useState<LookupFeedback>(null)
  const slugEditedRef = React.useRef(false)
  const lastLookupRef = React.useRef<string | null>(null)
  const lookupLocationRef = React.useRef<LookupLocation>({ city: null, state: null })

  const form = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    mode: "onTouched",
    defaultValues: {
      kind: "company",
      name: "",
      slug: "",
      legalName: "",
      cnpj: "",
      creci: "",
      creciNumber: "",
      creciState: "",
      city: "",
      state: "",
    },
  })

  const kind = useWatch({ control: form.control, name: "kind" })
  const isCompany = kind === "company"

  function runLookup(rawCnpj: string) {
    const cnpj = normalizeCnpj(rawCnpj)

    if (!isValidCnpj(cnpj)) {
      form.setError("cnpj", {
        type: "manual",
        message: "CNPJ inválido. Confira os números.",
      })
      return
    }

    lastLookupRef.current = cnpj
    setLookupFeedback(null)

    startLookup(async () => {
      const result = await lookupCnpj(cnpj)

      if (!result.ok) {
        setLookupFeedback({ type: "error", message: result.error })
        return
      }

      const options = { shouldDirty: true, shouldValidate: true }
      const { legalName, tradeName, city, state } = result.data

      form.setValue("legalName", legalName, options)

      // Cidade e UF andam juntas: se a pessoa digitou uma delas e ela diverge da
      // Receita, nenhuma das duas muda (senão sairia "Campinas / DF"). O que está
      // vazio, ou veio da consulta anterior, recebe o município da Receita.
      const previous = lookupLocationRef.current
      const currentCity = form.getValues("city")
      const currentState = form.getValues("state")
      const typedCity = !canReplaceWithLookup(currentCity, previous.city)
      const typedState = !canReplaceWithLookup(currentState, previous.state)
      const keptTypedLocation =
        (typedCity && city !== null && currentCity.trim() !== city) ||
        (typedState && state !== null && currentState !== state)

      if (!keptTypedLocation) {
        if (city && !typedCity) {
          form.setValue("city", city, options)
          previous.city = city
        }

        if (state && !typedState) {
          form.setValue("state", state, options)
          previous.state = state
        }
      }

      if (!form.getValues("name").trim()) {
        const name = tradeName ?? legalName
        form.setValue("name", name, options)

        if (!slugEditedRef.current) {
          form.setValue("slug", slugify(name), options)
        }
      }

      setLookupFeedback(
        result.warning
          ? { type: "warning", message: result.warning }
          : {
              type: "success",
              message: keptTypedLocation
                ? "Razão social preenchida pela Receita Federal. A cidade e a UF que você digitou foram mantidas."
                : "Dados preenchidos a partir da Receita Federal. Confira antes de continuar.",
            }
      )
    })
  }

  function onSubmit(values: OrganizationValues) {
    setFormError(null)

    startSubmit(async () => {
      const result = await createOrganization(values)

      if (!result) {
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof OrganizationValues, {
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
            <AlertTitle>
              {isCompany
                ? "Não foi possível criar a imobiliária"
                : "Não foi possível criar o cadastro"}
            </AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <FieldSet>
          <FieldLegend>Como você atua</FieldLegend>
          <FieldGroup>
            <Controller
              name="kind"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <ToggleGroup
                    aria-label="Como você atua"
                    variant="outline"
                    orientation="vertical"
                    className="w-full"
                    value={[field.value]}
                    onValueChange={(value: string[]) => {
                      const next = value[0]

                      if ((next === "company" || next === "person") && next !== field.value) {
                        field.onChange(next as OrganizationKind)
                        form.clearErrors([
                          "legalName",
                          "cnpj",
                          "creci",
                          "creciNumber",
                          "creciState",
                        ])
                      }
                    }}
                  >
                    <ToggleGroupItem
                      value="person"
                      className="h-auto w-full justify-start gap-2 py-2.5 text-left whitespace-normal"
                    >
                      <UserIcon data-icon="inline-start" />
                      Sou corretor autônomo (pessoa física)
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="company"
                      className="h-auto w-full justify-start gap-2 py-2.5 text-left whitespace-normal"
                    >
                      <BuildingIcon data-icon="inline-start" />
                      Sou imobiliária (pessoa jurídica)
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    {isCompany
                      ? "Pessoa jurídica: pedimos CNPJ, razão social e CRECI jurídico."
                      : "Pessoa física: pedimos o seu CRECI, sem CNPJ nem razão social."}
                  </FieldDescription>
                </Field>
              )}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Identificação</FieldLegend>
          <FieldDescription>
            {isCompany
              ? "Como a imobiliária aparece para a equipe e para os clientes."
              : "Como você aparece para a equipe e para os clientes."}
          </FieldDescription>
          <FieldGroup>
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="org-nome">
                    {isCompany ? "Nome da imobiliária" : "Nome profissional"}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="org-nome"
                    autoComplete={isCompany ? "organization" : "name"}
                    placeholder={isCompany ? "Ex.: Horizonte Imóveis" : "Ex.: Ana Souza Imóveis"}
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      field.onChange(event)

                      if (!slugEditedRef.current) {
                        form.setValue("slug", slugify(event.target.value), {
                          shouldValidate: form.formState.isSubmitted,
                        })
                      }
                    }}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            <Controller
              name="slug"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="org-slug">
                    {isCompany ? "Link da imobiliária" : "Seu link"}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      {...field}
                      id="org-slug"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="ex.: horizonte-imoveis"
                      aria-invalid={fieldState.invalid}
                      onChange={(event) => {
                        const slug = sanitizeTenantSlugInput(event.target.value, SLUG_MAX_LENGTH)
                        slugEditedRef.current = slug.length > 0
                        field.onChange(slug)
                      }}
                      onBlur={() => {
                        const slug = finishTenantSlugInput(field.value, SLUG_MAX_LENGTH)
                        if (slug !== field.value) field.onChange(slug)
                        field.onBlur()
                      }}
                    />
                    {linkPreview?.kind === "crm" ? (
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{linkPreview.suffix}</InputGroupText>
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      {linkPreview?.kind === "crm"
                        ? "Vira o endereço do CRM e dos links públicos."
                        : "Aparece nos links públicos, como o formulário de captação."}{" "}
                      {linkPreview && field.value ? (
                        <>
                          Ficará assim:{" "}
                          <span className="font-medium break-all text-foreground">
                            {`${linkPreview.prefix}${field.value}${linkPreview.suffix}`}
                          </span>
                          .{" "}
                        </>
                      ) : null}
                      Gerado a partir do nome; use letras sem acento, números e hífens.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        {isCompany ? (
          <FieldSet>
            <FieldLegend>Dados legais</FieldLegend>
            <FieldDescription>
              Informe o CNPJ para preencher a razão social, a cidade e a UF automaticamente.
            </FieldDescription>
            <FieldGroup>
              <Controller
                name="cnpj"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="org-cnpj">CNPJ (opcional)</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        {...field}
                        id="org-cnpj"
                        autoComplete="off"
                        placeholder="00.000.000/0000-00"
                        aria-invalid={fieldState.invalid}
                        onChange={(event) => {
                          const formatted = formatCnpj(event.target.value)
                          const cnpj = normalizeCnpj(formatted)
                          field.onChange(formatted)

                          if (
                            cnpj.length === 14 &&
                            isValidCnpj(cnpj) &&
                            cnpj !== lastLookupRef.current
                          ) {
                            runLookup(cnpj)
                          }
                        }}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          onClick={() => runLookup(field.value)}
                          disabled={isLookingUp || normalizeCnpj(field.value).length !== 14}
                        >
                          {isLookingUp ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <SearchIcon data-icon="inline-start" />
                          )}
                          Consultar
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : lookupFeedback?.type === "error" ? (
                      <FieldError>{lookupFeedback.message}</FieldError>
                    ) : (
                      <FieldDescription>
                        {lookupFeedback?.message ?? "Consultamos a Receita Federal pela BrasilAPI."}
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />
              <Controller
                name="legalName"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="org-razao-social">Razão social</FieldLabel>
                    <Input
                      {...field}
                      id="org-razao-social"
                      placeholder="Ex.: Horizonte Negócios Imobiliários Ltda."
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="creci"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="org-creci">CRECI jurídico</FieldLabel>
                    <Input
                      {...field}
                      id="org-creci"
                      autoComplete="off"
                      placeholder="Ex.: J-12345"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>
        ) : (
          <FieldSet>
            <FieldLegend>CRECI</FieldLegend>
            <FieldDescription>
              Número do seu registro no Conselho Regional de Corretores de Imóveis.
            </FieldDescription>
            <FieldGroup>
              <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
                <Controller
                  name="creciNumber"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="org-creci-numero">Número do CRECI</FieldLabel>
                      <Input
                        {...field}
                        id="org-creci-numero"
                        autoComplete="off"
                        placeholder="Ex.: 12345"
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
                <Controller
                  name="creciState"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="org-creci-uf">UF do CRECI</FieldLabel>
                      <Select
                        items={STATE_ITEMS}
                        value={field.value ? field.value : null}
                        onValueChange={(value) => field.onChange(value ?? "")}
                        onOpenChange={(open) => {
                          if (!open) field.onBlur()
                        }}
                      >
                        <SelectTrigger
                          id="org-creci-uf"
                          className="w-full"
                          aria-invalid={fieldState.invalid}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {BRAZILIAN_STATES.map((state) => (
                              <SelectItem key={state.code} value={state.code}>
                                {state.code} · {state.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </FieldSet>
        )}

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Localização</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-[1fr_14rem]">
            <Controller
              name="city"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="org-cidade">Cidade</FieldLabel>
                  <Input
                    {...field}
                    id="org-cidade"
                    autoComplete="address-level2"
                    placeholder="Ex.: Campinas"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            <Controller
              name="state"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="org-uf">UF</FieldLabel>
                  <Select
                    items={STATE_ITEMS}
                    value={field.value ? field.value : null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                    onOpenChange={(open) => {
                      if (!open) field.onBlur()
                    }}
                  >
                    <SelectTrigger id="org-uf" className="w-full" aria-invalid={fieldState.invalid}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {BRAZILIAN_STATES.map((state) => (
                          <SelectItem key={state.code} value={state.code}>
                            {state.code} · {state.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          </div>
        </FieldSet>

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            {isCompany ? "Criar imobiliária" : "Concluir cadastro"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
