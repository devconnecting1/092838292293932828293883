"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleIcon,
  RotateCwIcon,
  SendIcon,
} from "lucide-react"
import { Controller, useForm } from "react-hook-form"

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
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { trackLeadConversion } from "@/components/leads-publicos/tracking"
import { maskPhoneInput } from "@/lib/captacao/masks"
import { issuePropertyFormToken, submitPropertyLead } from "@/lib/imovel-publico/actions"
import type { SubmitLandingLeadResult } from "@/lib/leads-publicos/actions"
import {
  clickIdsFromSearch,
  sanitizeLandingUrl,
  sanitizeReferrer,
  utmFromSearch,
} from "@/lib/leads-publicos/attribution"
import {
  FRESH_TOKEN_WAIT_MS,
  HONEYPOT_FIELD,
  LEAD_INTEREST_LABELS,
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  type LeadInterest,
} from "@/lib/leads-publicos/constants"
import { createEventId } from "@/lib/leads-publicos/event-id"
import { landingLeadSchema, type LandingLeadValues } from "@/lib/leads-publicos/schemas"

export type PropertyLeadFormProps = {
  orgSlug: string
  propertyCode: string
  /** Nome da imobiliária, citado no consentimento LGPD e na confirmação. */
  organizationName: string
  /** Opções de interesse conforme a finalidade (venda, locação ou as duas). */
  interests: readonly LeadInterest[]
  defaultInterest: LeadInterest | null
  /** Link do WhatsApp com a mensagem citando o imóvel (tela de obrigado). */
  whatsappHref: string | null
  /** Âncora do aviso de privacidade na própria página. */
  privacyHref: string
}

type FormError = { message: string; expired: boolean } | null

type TokenState = { value: string; receivedAt: number } | null

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Atribuição só pelo link aberto (utm_*, gclid/gbraid/wbraid/fbclid), sem
 * cookies próprios de atribuição. Meta Pixel e gtag.js só existem na página
 * depois do aceite de cookies (LandingTracking).
 */
function readLinkAttribution() {
  const { search, href } = window.location

  return {
    utm: utmFromSearch(search),
    clickIds: clickIdsFromSearch(search),
    referrer: sanitizeReferrer(document.referrer),
    landingUrl: sanitizeLandingUrl(href),
  }
}

/**
 * Formulário de interesse da página do imóvel: nome, WhatsApp/telefone,
 * e-mail e mensagem opcionais e consentimento LGPD. O imóvel vem da página.
 */
export function PropertyLeadForm({
  orgSlug,
  propertyCode,
  organizationName,
  interests,
  defaultInterest,
  whatsappHref,
  privacyHref,
}: PropertyLeadFormProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tokenRef = React.useRef<TokenState>(null)
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<FormError>(null)
  const [success, setSuccess] = React.useState(false)

  const defaultValues = React.useMemo<LandingLeadValues>(
    () => ({
      name: "",
      phone: "",
      email: "",
      interest: defaultInterest ?? "",
      propertyId: "",
      typology: "",
      message: "",
      consent: false,
    }),
    [defaultInterest]
  )

  const form = useForm<LandingLeadValues>({
    resolver: zodResolver(landingLeadSchema),
    mode: "onTouched",
    defaultValues,
  })

  const id = (name: string) => `imovel-${name}`

  React.useEffect(() => {
    let active = true

    issuePropertyFormToken(orgSlug, propertyCode).then(
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
  }, [orgSlug, propertyCode])

  async function ensureToken() {
    const current = tokenRef.current

    if (current) {
      const elapsed = Date.now() - current.receivedAt

      if (elapsed < FRESH_TOKEN_WAIT_MS) {
        await wait(FRESH_TOKEN_WAIT_MS - elapsed)
      }

      return current.value
    }

    const result = await issuePropertyFormToken(orgSlug, propertyCode)

    if (!result.ok) {
      return null
    }

    tokenRef.current = { value: result.token, receivedAt: Date.now() }
    await wait(FRESH_TOKEN_WAIT_MS)
    return result.token
  }

  function applyResult(result: SubmitLandingLeadResult) {
    if (result.ok) {
      setSuccess(true)
      form.reset(defaultValues)
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      return
    }

    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      if (message) {
        form.setError(field as keyof LandingLeadValues, { type: "server", message })
      }
    }

    if (result.expired) {
      tokenRef.current = null
    }

    setFormError({ message: result.error, expired: Boolean(result.expired) })
  }

  function submitValues(values: LandingLeadValues, website: string) {
    setFormError(null)
    const eventId = createEventId()

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

        const result = await submitPropertyLead({
          orgSlug,
          propertyCode,
          values,
          antiBot: { token, website },
          attribution: readLinkAttribution(),
          eventId,
        })

        applyResult(result)

        if (result.ok) {
          // Sem aceite de cookies os scripts não existem e nada é enviado.
          trackLeadConversion({ eventId, interest: values.interest || null })
        }
      } catch {
        setFormError({
          message: "Sem conexão com o servidor. Verifique sua internet e tente de novo.",
          expired: false,
        })
      }
    })
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // O honeypot fica fora do react-hook-form: lido direto do formulário enviado.
    const website = new FormData(event.currentTarget).get(HONEYPOT_FIELD)

    return form.handleSubmit((values) =>
      submitValues(values, typeof website === "string" ? website : "")
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
              A equipe de {organizationName} já recebeu seus dados e vai falar com você em breve.
              {whatsappHref ? " Se preferir, adiante a conversa pelo WhatsApp agora." : null}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {whatsappHref ? (
              <Button
                size="lg"
                render={<a href={whatsappHref} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
              >
                <MessageCircleIcon data-icon="inline-start" />
                Falar agora no WhatsApp
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setSuccess(false)}>
              Enviar outra mensagem
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

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

          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={id("email")}>E-mail (opcional)</FieldLabel>
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

          {interests.length > 1 ? (
            <Controller
              name="interest"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldTitle id={id("interesse")}>Você quer</FieldTitle>
                  <ToggleGroup
                    aria-labelledby={id("interesse")}
                    variant="outline"
                    className="flex-wrap"
                    value={field.value ? [field.value] : []}
                    onValueChange={(value) => {
                      const next = interests.find((interest) => interest === value[0])
                      field.onChange(next ?? "")
                    }}
                  >
                    {interests.map((interest) => (
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

          <Controller
            name="message"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={id("mensagem")}>Mensagem (opcional)</FieldLabel>
                <Textarea
                  {...field}
                  id={id("mensagem")}
                  rows={3}
                  maxLength={LEAD_MESSAGE_MAX_LENGTH}
                  placeholder="Ex.: quero agendar uma visita no sábado de manhã."
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />

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
                    sobre este imóvel e o atendimento, conforme a Lei Geral de Proteção de Dados
                    (LGPD). Posso pedir a exclusão dos meus dados a qualquer momento.
                  </FieldLabel>
                  <FieldDescription>
                    <a href={privacyHref}>Como usamos seus dados</a>
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

          <Field>
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              Quero saber mais
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
