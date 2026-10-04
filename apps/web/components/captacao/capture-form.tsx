"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, CircleCheckIcon, RotateCwIcon, SendIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { BRAZILIAN_STATES, isStateCode } from "@workspace/core/br/states"
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_VALUES,
} from "@workspace/core/properties/enums"
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
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
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
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { lookupPostalCode, submitCaptureRequest } from "@/app/captar/[slug]/actions"
import { maskPhoneInput, maskPostalCodeInput } from "@/lib/captacao/masks"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"
import {
  CAPTURE_PURPOSES,
  publicCaptureSchema,
  type PublicCaptureValues,
} from "@/lib/captacao/schemas"
import { maskBrlInput } from "@/lib/propostas/money"

const HONEYPOT_FIELD = "website"

const TYPE_ITEMS: { label: string; value: string | null }[] = [
  { label: "Selecione", value: null },
  ...PROPERTY_TYPE_VALUES.map((type) => ({
    label: PROPERTY_TYPE_LABELS[type],
    value: type,
  })),
]

const STATE_ITEMS: { label: string; value: string | null }[] = [
  { label: "UF", value: null },
  ...BRAZILIAN_STATES.map((state) => ({
    label: state.code,
    value: state.code,
  })),
]

const PURPOSE_LABELS: Record<(typeof CAPTURE_PURPOSES)[number], string> = {
  sale: "Vender",
  rent: "Alugar",
  sale_rent: "Vender ou alugar",
}

const DEFAULT_VALUES: PublicCaptureValues = {
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  purpose: "sale",
  type: "",
  postalCode: "",
  neighborhood: "",
  city: "",
  state: "",
  expectedPrice: "",
  message: "",
  consent: false,
}

type FormError = { message: string; expired: boolean } | null

/** Quem preenche não tem login: o rascunho fica separado só por imobiliária. */
const VISITOR_DRAFT_USER = "visitante"

/** O consentimento precisa ser dado de novo a cada envio (LGPD): nunca volta do rascunho. */
const DRAFT_EXCLUDED_FIELDS = ["consent"] as const

const POSTAL_CODE_OFFLINE_MESSAGE =
  "Sem conexão para buscar o CEP agora. Preencha bairro, cidade e UF à mão."

type CaptureFormProps = {
  slug: string
  organizationName: string
  token: string
  /** Variáveis de cor da marca, aplicadas só no botão de envio. */
  brandStyle?: React.CSSProperties
}

export function CaptureForm({ slug, organizationName, token, brandStyle }: CaptureFormProps) {
  const router = useRouter()
  const lastPostalCodeRef = React.useRef("")
  const { isPending: isSubmitting, run: runSubmit } = useGuardedSubmit()
  const [isLookingUp, startLookup] = React.useTransition()
  const [isReloading, startReload] = React.useTransition()
  const [formError, setFormError] = React.useState<FormError>(null)
  const [postalCodeFeedback, setPostalCodeFeedback] = React.useState<string | null>(null)
  const [submitted, setSubmitted] = React.useState(false)

  const form = useForm<PublicCaptureValues>({
    resolver: zodResolver(publicCaptureSchema),
    mode: "onTouched",
    defaultValues: DEFAULT_VALUES,
  })
  const { isDirty } = form.formState

  // Sinal fraco no celular não apaga o que o proprietário digitou: fica só neste navegador.
  const draft = useFormDraft({
    form,
    scope: { userId: VISITOR_DRAFT_USER, organizationId: slug },
    formId: "captacao",
    exclude: DRAFT_EXCLUDED_FIELDS,
  })

  function runPostalCodeLookup(value: string) {
    const digits = value.replace(/\D/g, "")

    if (digits.length !== 8 || digits === lastPostalCodeRef.current) return

    lastPostalCodeRef.current = digits
    setPostalCodeFeedback(null)

    startLookup(async () => {
      let result: Awaited<ReturnType<typeof lookupPostalCode>>

      try {
        result = await lookupPostalCode(digits)
      } catch {
        // Sem internet: o CEP pode ser buscado de novo e o endereço, digitado.
        lastPostalCodeRef.current = ""
        setPostalCodeFeedback(POSTAL_CODE_OFFLINE_MESSAGE)
        return
      }

      if (!result.ok) {
        setPostalCodeFeedback(result.error)
        return
      }

      const options = { shouldDirty: true, shouldValidate: true }
      const { neighborhood, city, state } = result.data

      if (neighborhood) form.setValue("neighborhood", neighborhood, options)
      if (city) form.setValue("city", city, options)
      if (isStateCode(state)) form.setValue("state", state, options)
    })
  }

  function submitValues(values: PublicCaptureValues, website: string) {
    setFormError(null)

    runSubmit(
      async () => {
        const result = await submitCaptureRequest(slug, values, {
          token,
          website,
        })

        if (result.ok) {
          draft.clear()
          form.reset(DEFAULT_VALUES)
          lastPostalCodeRef.current = ""
          setPostalCodeFeedback(null)
          setSubmitted(true)
          window.scrollTo({ top: 0, behavior: "smooth" })
          return
        }

        for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
          if (message) {
            form.setError(field as keyof PublicCaptureValues, {
              type: "server",
              message,
            })
          }
        }

        setFormError({ message: result.error, expired: Boolean(result.expired) })
      },
      ({ message }) => {
        // Queda de rede ou erro inesperado: os campos continuam preenchidos.
        draft.saveNow()
        setFormError({ message, expired: false })
      }
    )
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // O honeypot fica fora do react-hook-form: lemos direto do formulário enviado.
    const website = new FormData(event.currentTarget).get(HONEYPOT_FIELD)

    return form.handleSubmit((values) =>
      submitValues(values, typeof website === "string" ? website : "")
    )(event)
  }

  if (submitted) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckIcon />
          </EmptyMedia>
          <EmptyTitle>Recebemos os dados do seu imóvel</EmptyTitle>
          <EmptyDescription>
            Obrigado! A equipe de {organizationName} vai entrar em contato em breve pelo telefone ou
            e-mail informado.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => setSubmitted(false)}>
            Enviar outro imóvel
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <UnsavedChangesGuard when={isDirty} />
      {/* Honeypot: invisível para pessoas; robôs costumam preencher. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="captar-website">Não preencha este campo</label>
        <Input
          id="captar-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <FieldGroup>
        <FormDraftNotice draft={draft} />
        <FieldSet>
          <FieldLegend>Seus dados</FieldLegend>
          <FieldDescription>Informe ao menos um telefone ou e-mail para contato.</FieldDescription>
          <FieldGroup>
            <Controller
              name="ownerName"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="captar-nome">Nome</FieldLabel>
                  <Input
                    {...field}
                    id="captar-nome"
                    autoComplete="name"
                    maxLength={120}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                name="ownerPhone"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-telefone">Telefone ou WhatsApp</FieldLabel>
                    <Input
                      {...field}
                      id="captar-telefone"
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
                name="ownerEmail"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-email">E-mail</FieldLabel>
                    <Input
                      {...field}
                      id="captar-email"
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
            </div>
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Sobre o imóvel</FieldLegend>
          <FieldGroup>
            <Controller
              name="purpose"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldTitle id="captar-finalidade">O que você quer fazer?</FieldTitle>
                  <ToggleGroup
                    aria-labelledby="captar-finalidade"
                    variant="outline"
                    className="flex-wrap"
                    value={[field.value]}
                    onValueChange={(value) => {
                      const next = CAPTURE_PURPOSES.find((purpose) => purpose === value[0])
                      if (next) field.onChange(next)
                    }}
                  >
                    {CAPTURE_PURPOSES.map((purpose) => (
                      <ToggleGroupItem key={purpose} value={purpose}>
                        {PURPOSE_LABELS[purpose]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      Anúncio para {LISTING_PURPOSE_LABELS[field.value].toLowerCase()}.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                name="type"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-tipo">Tipo de imóvel</FieldLabel>
                    <Select
                      items={TYPE_ITEMS}
                      value={field.value || null}
                      onValueChange={(value: string | null) => field.onChange(value ?? "")}
                      onOpenChange={(open) => {
                        if (!open) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        id="captar-tipo"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {TYPE_ITEMS.map((item) => (
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
              <Controller
                name="expectedPrice"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-valor">Valor esperado (opcional)</FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>
                        <InputGroupText>R$</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        {...field}
                        id="captar-valor"
                        inputMode="numeric"
                        placeholder="0,00"
                        aria-invalid={fieldState.invalid}
                        onChange={(event) => field.onChange(maskBrlInput(event.target.value))}
                      />
                    </InputGroup>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </div>
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Onde fica</FieldLegend>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
              <Controller
                name="postalCode"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-cep">CEP</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        {...field}
                        id="captar-cep"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        placeholder="00000-000"
                        aria-invalid={fieldState.invalid}
                        onChange={(event) => {
                          const masked = maskPostalCodeInput(event.target.value)
                          field.onChange(masked)
                          runPostalCodeLookup(masked)
                        }}
                      />
                      {isLookingUp ? (
                        <InputGroupAddon align="inline-end">
                          <Spinner aria-label="Buscando CEP" />
                        </InputGroupAddon>
                      ) : null}
                    </InputGroup>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : postalCodeFeedback ? (
                      <FieldDescription>{postalCodeFeedback}</FieldDescription>
                    ) : null}
                  </Field>
                )}
              />
              <Controller
                name="neighborhood"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-bairro">Bairro</FieldLabel>
                    <Input
                      {...field}
                      id="captar-bairro"
                      maxLength={120}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </div>
            <div className="grid grid-cols-[1fr_6.5rem] gap-5">
              <Controller
                name="city"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="captar-cidade">Cidade</FieldLabel>
                    <Input
                      {...field}
                      id="captar-cidade"
                      autoComplete="address-level2"
                      maxLength={120}
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
                    <FieldLabel htmlFor="captar-uf">UF</FieldLabel>
                    <Select
                      items={STATE_ITEMS}
                      value={field.value || null}
                      onValueChange={(value: string | null) => field.onChange(value ?? "")}
                      onOpenChange={(open) => {
                        if (!open) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        id="captar-uf"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {STATE_ITEMS.map((item) => (
                            <SelectItem key={item.value ?? "nenhuma"} value={item.value}>
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
            </div>
          </FieldGroup>
        </FieldSet>

        <Controller
          name="message"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="captar-mensagem">Mensagem (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="captar-mensagem"
                rows={4}
                maxLength={2000}
                placeholder="Ex.: 3 quartos, 1 vaga, reformado em 2023. Melhor horário para contato: à tarde."
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
                id="captar-consentimento"
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
              />
              <FieldContent>
                <FieldLabel htmlFor="captar-consentimento" className="font-normal">
                  Autorizo {organizationName} a usar meus dados para entrar em contato comigo sobre
                  este imóvel, conforme a Lei Geral de Proteção de Dados (LGPD). Posso pedir a
                  exclusão dos meus dados a qualquer momento.
                </FieldLabel>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isReloading}
                  onClick={() =>
                    startReload(() => {
                      setFormError(null)
                      router.refresh()
                    })
                  }
                >
                  {isReloading ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RotateCwIcon data-icon="inline-start" />
                  )}
                  Recarregar
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}

        <Field orientation="horizontal" className="justify-end">
          <Button
            type="submit"
            size="lg"
            className="w-full sm:w-auto"
            style={brandStyle}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SendIcon data-icon="inline-start" />
            )}
            Enviar dados do imóvel
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
