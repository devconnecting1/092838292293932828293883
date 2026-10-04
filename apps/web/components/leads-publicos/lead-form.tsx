"use client"

import * as React from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ListPlusIcon,
  MessageCircleIcon,
  RotateCwIcon,
  SendIcon,
} from "lucide-react"
import { Controller, useForm, type FieldErrors } from "react-hook-form"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { useLandingLeadInterest } from "@/components/landing/lead-interest"
import { trackLeadConversion } from "@/components/leads-publicos/tracking"
import { maskPhoneInput, whatsappUrl } from "@/lib/captacao/masks"
import {
  issueLandingFormToken,
  submitLandingLead,
  type SubmitLandingLeadResult,
} from "@/lib/leads-publicos/actions"
import { readLeadAttribution } from "@/lib/leads-publicos/attribution"
import {
  DEFAULT_CTA_LABEL,
  FRESH_TOKEN_WAIT_MS,
  HONEYPOT_FIELD,
  LEAD_INTEREST_LABELS,
  LEAD_INTERESTS,
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_TYPOLOGY_MAX_LENGTH,
  type LeadInterest,
} from "@/lib/leads-publicos/constants"
import { createEventId } from "@/lib/leads-publicos/event-id"
import { fillWhatsappMessage } from "@/lib/leads-publicos/landing-extras"
import {
  isUuid,
  LEAD_CONTACT_STEP_FIELDS,
  landingLeadSchema,
  type LandingLeadValues,
} from "@/lib/leads-publicos/schemas"

export type LeadFormProperty = {
  id: string
  title: string
  code: string | null
}

export type LeadFormProps = {
  orgSlug: string
  pageSlug: string
  /** Nome da imobiliária, citado no consentimento LGPD e na confirmação. */
  organizationName: string
  /** Título da página ({pagina} na mensagem do WhatsApp). */
  pageLabel: string
  privacyHref: string
  /** Texto do botão principal (CTA da página); sem ele, "Quero atendimento". */
  ctaLabel?: string | null
  /** Imóveis exibidos na página. O seletor só aparece com mais de um. */
  properties?: readonly LeadFormProperty[]
  /** Nomes das tipologias do lançamento. O seletor só aparece com mais de uma. */
  typologies?: readonly string[]
  /** Opções de interesse conforme o modelo da página (padrão: todas). */
  interests?: readonly LeadInterest[]
  defaultInterest?: LeadInterest | null
  /** Telefone (só dígitos) do botão "Falar agora no WhatsApp" na tela de obrigado. */
  whatsappPhone?: string | null
  /** content.whatsapp_message, com {codigo} e {pagina}. */
  whatsappMessageTemplate?: string | null
  /** Prefixo dos ids dos campos, se houver mais de um formulário na página. */
  idPrefix?: string
}

type Step = "contact" | "details"

type FormError = { message: string; expired: boolean } | null

type TokenState = { value: string; receivedAt: number } | null

type SuccessState = { whatsappHref: string | null } | null

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Etapa que mostra o primeiro campo com erro (o consentimento aparece nas duas). */
function stepForFields(fields: string[]): Step | null {
  if (fields.some((field) => LEAD_CONTACT_STEP_FIELDS.some((name) => name === field))) {
    return "contact"
  }

  return fields.some((field) => field !== "consent") ? "details" : null
}

/**
 * Formulário de lead em duas etapas, com um único envio (a RPC não devolve
 * referência do lead para complementar depois):
 * 1. nome + telefone/WhatsApp + consentimento, com o botão de envio principal;
 * 2. opcional, antes de enviar: e-mail, interesse, imóvel/tipologia e mensagem.
 * O imóvel ou a tipologia escolhidos nos CTAs da página (useLandingLeadInterest)
 * entram no envio quando o visitante não escolheu outro na etapa 2.
 */
export function LeadForm({
  orgSlug,
  pageSlug,
  organizationName,
  pageLabel,
  privacyHref,
  ctaLabel,
  properties = [],
  typologies = [],
  interests = LEAD_INTERESTS,
  defaultInterest = null,
  whatsappPhone,
  whatsappMessageTemplate,
  idPrefix = "lp",
}: LeadFormProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tokenRef = React.useRef<TokenState>(null)
  const { interest: pageInterest, setInterest: setPageInterest } = useLandingLeadInterest()
  const [isSubmitting, startSubmit] = React.useTransition()
  const [step, setStep] = React.useState<Step>("contact")
  const [formError, setFormError] = React.useState<FormError>(null)
  const [success, setSuccess] = React.useState<SuccessState>(null)

  const interestOptions = React.useMemo(
    () => LEAD_INTERESTS.filter((interest) => interests.includes(interest)),
    [interests]
  )

  const singlePropertyId = properties.length === 1 ? (properties[0]?.id ?? "") : ""

  const defaultValues = React.useMemo<LandingLeadValues>(
    () => ({
      name: "",
      phone: "",
      email: "",
      interest: defaultInterest && interestOptions.includes(defaultInterest) ? defaultInterest : "",
      propertyId: singlePropertyId,
      typology: "",
      message: "",
      consent: false,
    }),
    [defaultInterest, interestOptions, singlePropertyId]
  )

  const propertyItems = React.useMemo(
    () => [
      { label: "Nenhum em especial", value: null as string | null },
      ...properties.map((property) => ({
        label: property.title,
        value: property.id,
      })),
    ],
    [properties]
  )

  const typologyItems = React.useMemo(
    () => [
      { label: "Sem preferência", value: null as string | null },
      ...typologies.map((name) => ({ label: name, value: name })),
    ],
    [typologies]
  )

  const form = useForm<LandingLeadValues>({
    resolver: zodResolver(landingLeadSchema),
    mode: "onTouched",
    defaultValues,
  })

  const label = ctaLabel?.trim() || DEFAULT_CTA_LABEL
  const id = (name: string) => `${idPrefix}-${name}`

  // A página é estática (ISR): o token antirrobô é pedido ao servidor quando o
  // formulário monta, e o tempo mínimo de preenchimento conta a partir daí.
  React.useEffect(() => {
    let active = true

    issueLandingFormToken(orgSlug, pageSlug).then(
      (result) => {
        if (active && result.ok) {
          tokenRef.current = { value: result.token, receivedAt: Date.now() }
        }
      },
      () => {
        // Sem token agora: o envio pede outro.
      }
    )

    return () => {
      active = false
    }
  }, [orgSlug, pageSlug])

  async function ensureToken() {
    const current = tokenRef.current

    if (current) {
      const elapsed = Date.now() - current.receivedAt

      if (elapsed < FRESH_TOKEN_WAIT_MS) {
        await wait(FRESH_TOKEN_WAIT_MS - elapsed)
      }

      return current.value
    }

    const result = await issueLandingFormToken(orgSlug, pageSlug)

    if (!result.ok) {
      return null
    }

    tokenRef.current = { value: result.token, receivedAt: Date.now() }
    await wait(FRESH_TOKEN_WAIT_MS)
    return result.token
  }

  /** Completa imóvel/tipologia com o interesse escolhido na página, se a etapa 2 ficou vazia. */
  function withPageInterest(values: LandingLeadValues): LandingLeadValues {
    if (pageInterest?.kind === "property" && !values.propertyId && isUuid(pageInterest.id)) {
      return { ...values, propertyId: pageInterest.id }
    }

    if (pageInterest?.kind === "typology" && !values.typology) {
      return {
        ...values,
        typology: Array.from(pageInterest.name).slice(0, LEAD_TYPOLOGY_MAX_LENGTH).join("").trim(),
      }
    }

    return values
  }

  function buildWhatsappHref(values: LandingLeadValues) {
    const base = whatsappUrl(whatsappPhone)

    if (!base) return null

    const selected =
      properties.find((property) => property.id === values.propertyId) ??
      (properties.length === 1 ? properties[0] : undefined)
    const interestCode =
      pageInterest?.kind === "property" && pageInterest.id === values.propertyId
        ? pageInterest.code
        : null
    const text = fillWhatsappMessage(whatsappMessageTemplate, {
      codigo: selected?.code ?? interestCode,
      pagina: pageLabel,
    })

    return `${base}?text=${encodeURIComponent(text)}`
  }

  async function openDetails() {
    const fields: (keyof LandingLeadValues)[] = form.getValues("phone")
      ? ["name", "phone"]
      : ["name"]

    if (await form.trigger(fields)) {
      setFormError(null)
      setStep("details")
    }
  }

  function applyResult(
    result: SubmitLandingLeadResult,
    values: LandingLeadValues,
    eventId: string,
    honeypotFilled: boolean
  ) {
    if (result.ok) {
      setSuccess({ whatsappHref: buildWhatsappHref(values) })
      form.reset(defaultValues)
      setStep("contact")
      setPageInterest(null)

      // O servidor responde sucesso ao robô de propósito; aqui o navegador já
      // sabe que o honeypot foi preenchido e não polui as conversões dos anúncios.
      if (!honeypotFilled) {
        trackLeadConversion({ eventId, interest: values.interest || null })
      }

      containerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      })
      return
    }

    const fieldErrors = Object.entries(result.fieldErrors ?? {})

    for (const [field, message] of fieldErrors) {
      if (message) {
        form.setError(field as keyof LandingLeadValues, {
          type: "server",
          message,
        })
      }
    }

    const target = stepForFields(fieldErrors.map(([field]) => field))

    if (target) {
      setStep(target)
    }

    if (result.expired) {
      // Token vencido: descarta para o próximo envio pedir um novo.
      tokenRef.current = null
    }

    setFormError({ message: result.error, expired: Boolean(result.expired) })
  }

  function submitValues(formValues: LandingLeadValues, website: string) {
    setFormError(null)
    const eventId = createEventId()
    const values = withPageInterest(formValues)

    startSubmit(async () => {
      try {
        const token = await ensureToken()

        if (!token) {
          setFormError({
            message: "Não foi possível preparar o envio. Recarregue a página e tente de novo.",
            expired: false,
          })
          return
        }

        const result = await submitLandingLead({
          orgSlug,
          pageSlug,
          values,
          antiBot: { token, website },
          attribution: readLeadAttribution(),
          eventId,
        })

        applyResult(result, values, eventId, website.trim() !== "")
      } catch {
        setFormError({
          message: "Sem conexão com o servidor. Verifique sua internet e tente de novo.",
          expired: false,
        })
      }
    })
  }

  function handleInvalid(errors: FieldErrors<LandingLeadValues>) {
    const target = stepForFields(Object.keys(errors))

    if (target) {
      setStep(target)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // O honeypot fica fora do react-hook-form: lido direto do formulário enviado.
    const website = new FormData(event.currentTarget).get(HONEYPOT_FIELD)

    return form.handleSubmit(
      (values) => submitValues(values, typeof website === "string" ? website : ""),
      handleInvalid
    )(event)
  }

  if (success) {
    return (
      <div ref={containerRef} role="status" aria-live="polite">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Recebemos seu contato!</EmptyTitle>
            <EmptyDescription>
              Obrigado. A equipe de {organizationName} já recebeu seus dados e vai falar com você em
              breve.
              {success.whatsappHref
                ? " Se preferir, adiante a conversa pelo WhatsApp agora."
                : null}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {success.whatsappHref ? (
              <Button
                size="lg"
                render={<a href={success.whatsappHref} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
              >
                <MessageCircleIcon data-icon="inline-start" />
                Falar agora no WhatsApp
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setSuccess(null)}>
              Enviar outra mensagem
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const submitIcon = isSubmitting ? (
    <Spinner data-icon="inline-start" />
  ) : (
    <SendIcon data-icon="inline-start" />
  )

  return (
    <div ref={containerRef}>
      <form onSubmit={handleSubmit} noValidate>
        {/* Honeypot: invisível para pessoas; robôs costumam preencher. */}
        <div aria-hidden="true" className="sr-only">
          <label htmlFor={id("website")}>Não preencha este campo</label>
          <Input
            id={id("website")}
            name={HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>

        <FieldGroup>
          {step === "contact" ? (
            <>
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={id("nome")}>Nome</FieldLabel>
                    <Input
                      {...field}
                      id={id("nome")}
                      autoComplete="name"
                      maxLength={LEAD_NAME_MAX_LENGTH}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="phone"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={id("telefone")}>WhatsApp ou telefone</FieldLabel>
                    <Input
                      {...field}
                      id={id("telefone")}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="(11) 98765-4321"
                      aria-invalid={fieldState.invalid}
                      onChange={(event) => field.onChange(maskPhoneInput(event.target.value))}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </>
          ) : (
            <FieldSet>
              <FieldLegend variant="label">Detalhes (opcional)</FieldLegend>
              <FieldDescription>
                Ajudam o corretor a já chegar com as opções certas. Pode enviar sem preencher.
              </FieldDescription>
              <FieldGroup>
                <Controller
                  name="email"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={id("email")}>E-mail</FieldLabel>
                      <Input
                        {...field}
                        id={id("email")}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="voce@exemplo.com.br"
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />

                {interestOptions.length > 0 ? (
                  <Controller
                    name="interest"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldTitle id={id("interesse")}>Você tem interesse em</FieldTitle>
                        <ToggleGroup
                          aria-labelledby={id("interesse")}
                          variant="outline"
                          className="flex-wrap"
                          value={field.value ? [field.value] : []}
                          onValueChange={(value) => {
                            const next = interestOptions.find((interest) => interest === value[0])
                            field.onChange(next ?? "")
                          }}
                        >
                          {interestOptions.map((interest) => (
                            <ToggleGroupItem key={interest} value={interest}>
                              {LEAD_INTEREST_LABELS[interest]}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                        {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                      </Field>
                    )}
                  />
                ) : null}

                {properties.length > 1 ? (
                  <Controller
                    name="propertyId"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={id("imovel")}>Imóvel de interesse</FieldLabel>
                        <Select
                          items={propertyItems}
                          value={field.value || null}
                          onValueChange={(value: string | null) => field.onChange(value ?? "")}
                          onOpenChange={(open) => {
                            if (!open) field.onBlur()
                          }}
                        >
                          <SelectTrigger
                            id={id("imovel")}
                            className="w-full"
                            aria-invalid={fieldState.invalid}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {propertyItems.map((item) => (
                                <SelectItem key={item.value ?? "nenhum"} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                      </Field>
                    )}
                  />
                ) : null}

                {typologies.length > 1 ? (
                  <Controller
                    name="typology"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={id("tipologia")}>Tipologia de interesse</FieldLabel>
                        <Select
                          items={typologyItems}
                          value={field.value || null}
                          onValueChange={(value: string | null) => field.onChange(value ?? "")}
                          onOpenChange={(open) => {
                            if (!open) field.onBlur()
                          }}
                        >
                          <SelectTrigger
                            id={id("tipologia")}
                            className="w-full"
                            aria-invalid={fieldState.invalid}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {typologyItems.map((item) => (
                                <SelectItem
                                  key={item.value ?? "sem-preferencia"}
                                  value={item.value}
                                >
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                      </Field>
                    )}
                  />
                ) : null}

                <Controller
                  name="message"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={id("mensagem")}>Mensagem</FieldLabel>
                      <Textarea
                        {...field}
                        id={id("mensagem")}
                        rows={3}
                        maxLength={LEAD_MESSAGE_MAX_LENGTH}
                        placeholder="Ex.: procuro 2 quartos perto do metrô. Prefiro contato à tarde."
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldSet>
          )}

          <Controller
            name="consent"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field orientation="horizontal" data-invalid={fieldState.invalid}>
                <Checkbox
                  id={id("consentimento")}
                  name={field.name}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid}
                />
                <FieldContent>
                  <FieldLabel htmlFor={id("consentimento")} className="font-normal">
                    Autorizo {organizationName} a usar meus dados para entrar em contato comigo
                    sobre imóveis e este atendimento, conforme a Lei Geral de Proteção de Dados
                    (LGPD). Posso pedir a exclusão dos meus dados a qualquer momento.
                  </FieldLabel>
                  <FieldDescription>
                    <Link href={privacyHref}>Política de privacidade</Link>
                  </FieldDescription>
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </FieldContent>
              </Field>
            )}
          />

          {formError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível enviar</AlertTitle>
              <AlertDescription>{formError.message}</AlertDescription>
              {formError.expired ? (
                <AlertAction>
                  <Button type="submit" variant="outline" size="sm" disabled={isSubmitting}>
                    <RotateCwIcon data-icon="inline-start" />
                    Enviar de novo
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          ) : null}

          {step === "contact" ? (
            <Field>
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {submitIcon}
                {label}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isSubmitting}
                onClick={() => void openDetails()}
              >
                <ListPlusIcon data-icon="inline-start" />
                Adicionar detalhes (opcional)
              </Button>
            </Field>
          ) : (
            <Field>
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {submitIcon}
                Enviar agora
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isSubmitting}
                onClick={() => setStep("contact")}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Voltar
              </Button>
            </Field>
          )}
        </FieldGroup>
      </form>
    </div>
  )
}
