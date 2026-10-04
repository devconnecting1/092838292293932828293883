"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { BuildingIcon, CircleAlertIcon, SearchIcon, UserIcon } from "lucide-react"
import { Controller, useForm, useWatch, type Control } from "react-hook-form"

import { isValidPostalCode, normalizePostalCode } from "@workspace/core/br/documents"
import { BRAZILIAN_STATES, isStateCode } from "@workspace/core/br/states"
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
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
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
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { TagsInput } from "@/components/clientes/tags-input"
import { ROLE_LABELS, type Role } from "@/lib/auth/roles"
import { createClientRecord, lookupClientAddress, updateClientRecord } from "@/lib/clientes/actions"
import {
  CLIENT_SOURCE_LABELS,
  CLIENT_SOURCE_VALUES,
  CLIENTS_PATH,
  LGPD_LEGAL_BASIS_LABELS,
  LGPD_LEGAL_BASIS_VALUES,
} from "@/lib/clientes/constants"
import {
  maskCnpjInput,
  maskCpfInput,
  maskPhoneInput,
  maskPostalCodeInput,
} from "@/lib/clientes/format"
import type { MemberOption } from "@/lib/clientes/options"
import { canChooseClientAssignee } from "@/lib/clientes/permissions"
import { clientFormSchema, type ClientFormValues } from "@/lib/clientes/schemas"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"

/**
 * Nunca vão para o rascunho local. CPF/CNPJ ("document") e RG já saem pela
 * regra geral de campos sensíveis; a data de nascimento sai por minimização (LGPD).
 */
const CLIENT_DRAFT_EXCLUDE = ["document", "rg", "birthDate"] as const

const STATE_ITEMS = [
  { label: "UF", value: null },
  ...BRAZILIAN_STATES.map((state) => ({
    label: state.code,
    value: state.code,
  })),
]

const SOURCE_ITEMS = [
  { label: "Não informada", value: null },
  ...CLIENT_SOURCE_VALUES.map((source) => ({
    label: CLIENT_SOURCE_LABELS[source],
    value: source,
  })),
]

const LEGAL_BASIS_ITEMS = [
  { label: "Selecione a base legal", value: null },
  ...LGPD_LEGAL_BASIS_VALUES.map((basis) => ({
    label: LGPD_LEGAL_BASIS_LABELS[basis],
    value: basis,
  })),
]

const LEGAL_BASIS_HINTS: Record<string, string> = {
  consent:
    "O cliente autorizou expressamente o uso dos dados. Guarde a evidência (mensagem, formulário assinado) na aba Documentos.",
  contract:
    "Os dados são necessários para uma proposta, locação, compra e venda ou outro contrato com o cliente.",
  legitimate_interest:
    "Uso compatível com o que o cliente espera (ex.: retorno de um contato que ele iniciou). Registre a justificativa nas observações.",
}

/**
 * Campos curtos: 2 colunas e, com o formulário a partir de 64rem (≈ 1536 px de tela com a
 * sidebar aberta), 3 colunas. Container query no FieldGroup, que acompanha a sidebar.
 */
const SHORT_FIELDS_GRID =
  "grid gap-5 @min-[40rem]/field-group:grid-cols-2 @min-[64rem]/field-group:grid-cols-3"

type TextFieldName = Exclude<keyof ClientFormValues, "kind" | "tags">

type TextFieldProps = Omit<
  React.ComponentProps<typeof Input>,
  "name" | "value" | "onChange" | "onBlur" | "defaultValue" | "id"
> & {
  control: Control<ClientFormValues>
  name: TextFieldName
  label: string
  description?: React.ReactNode
  mask?: (value: string) => string
}

function TextField({ control, name, label, description, mask, ...inputProps }: TextFieldProps) {
  const id = `cliente-${name}`

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...inputProps}
            id={id}
            ref={field.ref}
            name={field.name}
            value={field.value}
            onBlur={field.onBlur}
            onChange={(event) =>
              field.onChange(mask ? mask(event.target.value) : event.target.value)
            }
            aria-invalid={fieldState.invalid}
          />
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  )
}

type ClientFormProps = {
  mode: "create" | "edit"
  clientId?: string
  /** Usuário e imobiliária atuais: separam o rascunho local. */
  userId: string
  organizationId: string
  initialValues: ClientFormValues
  members: MemberOption[]
  role: Role
  existingTags: string[]
  /** "AAAA-MM-DD" de hoje em Brasília (limite das datas). */
  today: string
}

type CepFeedback = { type: "success" | "error"; message: string } | null

export function ClientForm({
  mode,
  clientId,
  userId,
  organizationId,
  initialValues,
  members,
  role,
  existingTags,
  today,
}: ClientFormProps) {
  const router = useRouter()
  const { isPending: isSubmitting, run: runSubmit } = useGuardedSubmit()
  const [isLookingUp, startLookup] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [cepFeedback, setCepFeedback] = React.useState<CepFeedback>(null)
  const lastCepRef = React.useRef(normalizePostalCode(initialValues.postalCode))

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    mode: "onTouched",
    defaultValues: initialValues,
  })

  const draft = useFormDraft({
    form,
    scope: { userId, organizationId },
    formId: "cliente",
    recordId: mode === "edit" ? (clientId ?? null) : null,
    exclude: CLIENT_DRAFT_EXCLUDE,
    // Edição sem id não tem registro certo para guardar.
    enabled: mode === "create" || Boolean(clientId),
  })
  const { isDirty } = form.formState

  const kind = useWatch({ control: form.control, name: "kind" })
  const legalBasis = useWatch({ control: form.control, name: "legalBasis" })
  const isPf = kind === "pf"
  const canChooseAssignee = canChooseClientAssignee(role)

  const assigneeItems = [
    { label: "Sem responsável", value: null },
    ...members.map((member) => ({
      label: `${member.name} · ${ROLE_LABELS[member.role]}`,
      value: member.id,
    })),
  ]

  function runCepLookup(digits: string) {
    lastCepRef.current = digits
    setCepFeedback(null)

    startLookup(async () => {
      let result: Awaited<ReturnType<typeof lookupClientAddress>>

      try {
        result = await lookupClientAddress(digits)
      } catch {
        // Sem conexão: a busca falha, mas o formulário continua na tela.
        setCepFeedback({
          type: "error",
          message: "Sem conexão para buscar o CEP. Preencha o endereço ou tente de novo.",
        })
        return
      }

      if (!result.ok) {
        setCepFeedback({ type: "error", message: result.error })
        return
      }

      const options = { shouldDirty: true, shouldValidate: true }
      const { street, neighborhood, city, state } = result.data

      if (street) form.setValue("street", street, options)
      if (neighborhood) form.setValue("neighborhood", neighborhood, options)
      if (city) form.setValue("city", city, options)
      if (isStateCode(state)) form.setValue("state", state, options)

      setCepFeedback({
        type: "success",
        message: "Endereço preenchido pelo CEP. Confira o número e o complemento.",
      })
    })
  }

  function onSubmit(values: ClientFormValues) {
    setFormError(null)

    runSubmit(
      async () => {
        const result =
          mode === "edit" && clientId
            ? await updateClientRecord(clientId, values)
            : await createClientRecord(values)

        if (!result.ok) {
          for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
            const fieldName = path.split(".")[0] as keyof ClientFormValues
            form.setError(fieldName, { type: "server", message })
          }

          setFormError(result.error)
          return
        }

        draft.clear()
        toast.add({ title: result.message ?? "Cliente salvo.", type: "success" })
        router.push(`${CLIENTS_PATH}/${result.data.id}`)
      },
      ({ message }) => {
        // Queda de rede ou erro inesperado: os campos continuam preenchidos.
        draft.saveNow()
        setFormError(message)
      }
    )
  }

  const cancelHref = mode === "edit" && clientId ? `${CLIENTS_PATH}/${clientId}` : CLIENTS_PATH

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <UnsavedChangesGuard when={isDirty} />
      <FieldGroup>
        <FormDraftNotice
          draft={draft}
          note="CPF/CNPJ, RG e data de nascimento não entram no rascunho."
        />
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>
              {mode === "edit"
                ? "Não foi possível salvar o cliente"
                : "Não foi possível cadastrar o cliente"}
            </AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <FieldSet>
          <FieldLegend>Identificação</FieldLegend>
          <FieldGroup>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Field>
                  <FieldTitle id="cliente-tipo-label">Tipo de cliente</FieldTitle>
                  <ToggleGroup
                    aria-labelledby="cliente-tipo-label"
                    variant="outline"
                    value={[field.value]}
                    onValueChange={(value: string[]) => {
                      const next = value[0]

                      if ((next === "pf" || next === "pj") && next !== field.value) {
                        field.onChange(next)
                        form.setValue("document", "")
                        form.clearErrors(["document", "name"])
                      }
                    }}
                  >
                    <ToggleGroupItem value="pf">
                      <UserIcon data-icon="inline-start" />
                      Pessoa física
                    </ToggleGroupItem>
                    <ToggleGroupItem value="pj">
                      <BuildingIcon data-icon="inline-start" />
                      Pessoa jurídica
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              )}
            />

            {isPf ? (
              <div className={SHORT_FIELDS_GRID}>
                <TextField
                  control={form.control}
                  name="name"
                  label="Nome completo"
                  autoComplete="name"
                  placeholder="Ex.: Maria da Silva"
                />
                <TextField
                  control={form.control}
                  name="document"
                  label="CPF"
                  mask={maskCpfInput}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                />
                <TextField
                  control={form.control}
                  name="rg"
                  label="RG"
                  autoComplete="off"
                  placeholder="Ex.: 12.345.678-9 SSP/SP"
                />
                <TextField
                  control={form.control}
                  name="birthDate"
                  label="Data de nascimento"
                  type="date"
                  max={today}
                />
              </div>
            ) : (
              <div className={SHORT_FIELDS_GRID}>
                <TextField
                  control={form.control}
                  name="name"
                  label="Razão social"
                  autoComplete="organization"
                  placeholder="Ex.: Horizonte Participações Ltda."
                />
                <TextField
                  control={form.control}
                  name="tradeName"
                  label="Nome fantasia"
                  placeholder="Ex.: Horizonte"
                />
                <TextField
                  control={form.control}
                  name="document"
                  label="CNPJ"
                  mask={maskCnpjInput}
                  autoComplete="off"
                  placeholder="00.000.000/0000-00"
                  description="Aceita o CNPJ numérico e o alfanumérico."
                />
              </div>
            )}
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Contato</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField
              control={form.control}
              name="email"
              label="E-mail"
              type="email"
              autoComplete="email"
              placeholder="nome@exemplo.com"
            />
            <TextField
              control={form.control}
              name="phone"
              label="Telefone"
              type="tel"
              mask={maskPhoneInput}
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(11) 3456-7890"
            />
            <TextField
              control={form.control}
              name="whatsapp"
              label="WhatsApp"
              type="tel"
              mask={maskPhoneInput}
              inputMode="tel"
              placeholder="(11) 98765-4321"
            />
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Endereço</FieldLegend>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-[14rem_1fr_8rem]">
              <Controller
                control={form.control}
                name="postalCode"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="cliente-postalCode">CEP</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="cliente-postalCode"
                        ref={field.ref}
                        name={field.name}
                        value={field.value}
                        onBlur={field.onBlur}
                        inputMode="numeric"
                        autoComplete="postal-code"
                        placeholder="00000-000"
                        aria-invalid={fieldState.invalid}
                        onChange={(event) => {
                          const masked = maskPostalCodeInput(event.target.value)
                          const digits = normalizePostalCode(masked)
                          field.onChange(masked)

                          if (digits.length === 8 && digits !== lastCepRef.current) {
                            runCepLookup(digits)
                          }
                        }}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          onClick={() => runCepLookup(normalizePostalCode(field.value))}
                          disabled={isLookingUp || !isValidPostalCode(field.value)}
                        >
                          {isLookingUp ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <SearchIcon data-icon="inline-start" />
                          )}
                          Buscar
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : cepFeedback?.type === "error" ? (
                      <FieldError>{cepFeedback.message}</FieldError>
                    ) : (
                      <FieldDescription>
                        {cepFeedback?.message ?? "Preenche rua, bairro, cidade e UF."}
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />
              <TextField
                control={form.control}
                name="street"
                label="Rua"
                autoComplete="address-line1"
              />
              <TextField control={form.control} name="streetNumber" label="Número" />
            </div>
            <div className="grid gap-5 sm:grid-cols-[1fr_1fr_1fr_8rem]">
              <TextField
                control={form.control}
                name="complement"
                label="Complemento"
                autoComplete="address-line2"
              />
              <TextField control={form.control} name="neighborhood" label="Bairro" />
              <TextField
                control={form.control}
                name="city"
                label="Cidade"
                autoComplete="address-level2"
              />
              <Controller
                control={form.control}
                name="state"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="cliente-state">UF</FieldLabel>
                    <Select
                      items={STATE_ITEMS}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(open) => {
                        if (!open) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        id="cliente-state"
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

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Atendimento</FieldLegend>
          <FieldGroup>
            <div className={SHORT_FIELDS_GRID}>
              <Controller
                control={form.control}
                name="source"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="cliente-source">Origem</FieldLabel>
                    <Select
                      items={SOURCE_ITEMS}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(open) => {
                        if (!open) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        id="cliente-source"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SOURCE_ITEMS.map((item) => (
                            <SelectItem key={item.value ?? "nenhuma"} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>Por onde o cliente chegou à imobiliária.</FieldDescription>
                    )}
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="assignedTo"
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    data-disabled={!canChooseAssignee || undefined}
                  >
                    <FieldLabel htmlFor="cliente-assignedTo">Responsável</FieldLabel>
                    <Select
                      items={assigneeItems}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(open) => {
                        if (!open) field.onBlur()
                      }}
                      disabled={!canChooseAssignee}
                    >
                      <SelectTrigger
                        id="cliente-assignedTo"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {assigneeItems.map((item) => (
                            <SelectItem key={item.value ?? "nenhum"} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>
                        {canChooseAssignee
                          ? "Corretores só veem os clientes atribuídos a eles ou compartilhados."
                          : "Como corretor, você fica como responsável pelos clientes que cadastra."}
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="tags"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="cliente-tags">Etiquetas</FieldLabel>
                  <TagsInput
                    id="cliente-tags"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    suggestions={existingTags}
                    invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>Pressione Enter ou vírgula para adicionar.</FieldDescription>
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="notes"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="cliente-notes">Observações</FieldLabel>
                  <Textarea
                    {...field}
                    id="cliente-notes"
                    rows={4}
                    placeholder="Preferências, melhor horário para contato, histórico relevante…"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Proteção de dados (LGPD)</FieldLegend>
          <FieldDescription>
            Informe a base legal que autoriza a imobiliária a tratar os dados deste cliente.
            Obrigatório.
          </FieldDescription>
          <div className={SHORT_FIELDS_GRID}>
            <Controller
              control={form.control}
              name="legalBasis"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="cliente-legalBasis">Base legal</FieldLabel>
                  <Select
                    items={LEGAL_BASIS_ITEMS}
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                    onOpenChange={(open) => {
                      if (!open) field.onBlur()
                    }}
                  >
                    <SelectTrigger
                      id="cliente-legalBasis"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {LGPD_LEGAL_BASIS_VALUES.map((basis) => (
                          <SelectItem key={basis} value={basis}>
                            {LGPD_LEGAL_BASIS_LABELS[basis]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : legalBasis && LEGAL_BASIS_HINTS[legalBasis] ? (
                    <FieldDescription>{LEGAL_BASIS_HINTS[legalBasis]}</FieldDescription>
                  ) : null}
                </Field>
              )}
            />
            {legalBasis === "consent" ? (
              <TextField
                control={form.control}
                name="consentDate"
                label="Data do consentimento"
                type="date"
                max={today}
                description="Dia em que o cliente autorizou o uso dos dados."
              />
            ) : null}
          </div>
        </FieldSet>

        {/* Barra de ações fixa no rodapé enquanto o formulário rola. */}
        <Field
          orientation="horizontal"
          className="sticky bottom-0 z-10 justify-end border-t bg-background py-3"
        >
          <Button variant="outline" render={<Link href={cancelHref} />} nativeButton={false}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            {mode === "edit" ? "Salvar alterações" : "Cadastrar cliente"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
