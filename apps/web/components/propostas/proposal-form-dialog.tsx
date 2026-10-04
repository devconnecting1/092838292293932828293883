"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { BadgePercentIcon, CircleAlertIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import type { FormDraftScope } from "@workspace/core/forms/draft"
import { LISTING_PURPOSE_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { OptionCombobox, type ComboboxOption } from "@/components/propostas/option-combobox"
import { ProposalNegotiationPanel } from "@/components/propostas/proposal-negotiation-panel"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useFormDraftScope } from "@/lib/forms/draft/use-form-draft-scope"
import { useGuardedSubmit, type SubmitFailure } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"
import { changeProposalStatus, createProposal, updateProposal } from "@/lib/propostas/actions"
import { maskBrlInput } from "@/lib/propostas/money"
import { proposalFormSchema, type ProposalFormValues } from "@/lib/propostas/schemas"

export type ProposalPropertyOption = ComboboxOption & {
  purpose: "sale" | "rent" | "sale_rent"
}

export type EditableProposal = {
  id: string
  /** Proposta encerrada ou sem permissão: só leitura. */
  readOnly: boolean
  readOnlyReason: string | null
  values: ProposalFormValues
  propertyLabel: string
  clientLabel: string
  brokerLabel: string | null
}

const EMPTY_VALUES: ProposalFormValues = {
  propertyId: "",
  clientId: "",
  brokerId: "",
  purpose: "sale",
  amount: "",
  paymentTerms: "",
  conditions: "",
  validUntil: "",
  expectedCloseDate: "",
  downPayment: "",
  financingAmount: "",
  exchangeDescription: "",
  paymentDeadline: "",
}

function withFallback(options: ComboboxOption[], value: string | undefined, label: string) {
  return value && !options.some((option) => option.value === value)
    ? [...options, { value, label }]
    : options
}

type ProposalFormProps = {
  properties: ProposalPropertyOption[]
  clients: ComboboxOption[]
  brokers: ComboboxOption[]
  editing?: EditableProposal | null
  defaultPropertyId?: string
  defaultBrokerId?: string
  /**
   * Corretor e captador: na nova proposta o corretor é sempre o próprio
   * usuário (`defaultBrokerId`), sem opção de troca.
   */
  lockBroker?: boolean
  /** Depois de salvar um valor que depende da aprovação do gerente. */
  onDiscountApprovalNeeded?: (proposalId: string) => void
  /**
   * Usuário + imobiliária para o rascunho local. Sem isso, o formulário
   * pergunta ao servidor ao abrir (uma chamada a mais).
   */
  draftScope?: FormDraftScope
}

type ProposalFormDialogProps = ProposalFormProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProposalFormDialog({ open, onOpenChange, ...formProps }: ProposalFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        {/* O conteúdo monta a cada abertura: o formulário sempre começa com os dados certos. */}
        <ProposalForm
          key={formProps.editing?.id ?? "nova-proposta"}
          {...formProps}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function getInitialValues({
  editing,
  properties,
  defaultPropertyId,
  defaultBrokerId,
}: ProposalFormProps): ProposalFormValues {
  if (editing) {
    return editing.values
  }

  const property = properties.find((option) => option.value === defaultPropertyId)

  return {
    ...EMPTY_VALUES,
    propertyId: property?.value ?? "",
    brokerId: defaultBrokerId ?? "",
    purpose: property?.purpose === "rent" ? "rent" : "sale",
  }
}

function ProposalForm({ onDone, ...props }: ProposalFormProps & { onDone: () => void }) {
  const { properties, clients, brokers, editing, onDiscountApprovalNeeded } = props
  const { isPending: isSubmitting, run: runSubmit } = useGuardedSubmit()
  const [formError, setFormError] = React.useState<string | null>(null)
  // Recusa do gatilho de desconto, amarrada ao valor que foi barrado.
  const [discountBlock, setDiscountBlock] = React.useState<{
    message: string
    amount: string
  } | null>(null)
  const readOnly = editing?.readOnly ?? false
  const brokerLocked = !editing && Boolean(props.lockBroker)

  const form = useForm<ProposalFormValues>({
    resolver: zodResolver(proposalFormSchema),
    mode: "onTouched",
    defaultValues: getInitialValues(props),
  })
  const { isDirty } = form.formState

  // Rascunho por proposta (ou nova); proposta só de leitura não guarda nada.
  const draftScope = useFormDraftScope(props.draftScope, !readOnly)
  const draft = useFormDraft({
    form,
    scope: draftScope,
    formId: "proposta",
    recordId: editing?.id ?? null,
    enabled: !readOnly,
  })

  const propertyId = useWatch({ control: form.control, name: "propertyId" })
  const amount = useWatch({ control: form.control, name: "amount" })
  // Mudou o valor depois da recusa: vale tentar salvar do jeito normal de novo.
  const blockedDiscount = discountBlock?.amount === amount ? discountBlock : null

  const propertyOptions = React.useMemo(
    () => withFallback(properties, editing?.values.propertyId, editing?.propertyLabel ?? ""),
    [properties, editing]
  )

  const clientOptions = React.useMemo(
    () => withFallback(clients, editing?.values.clientId, editing?.clientLabel ?? ""),
    [clients, editing]
  )

  const brokerItems = React.useMemo(() => {
    const options = withFallback(
      brokers,
      editing?.values.brokerId || undefined,
      editing?.brokerLabel ?? "Ex-membro da equipe"
    )

    return [
      { label: "Sem corretor", value: null as string | null },
      ...options.map((option) => ({
        label: option.label,
        value: option.value as string | null,
      })),
    ]
  }, [brokers, editing])

  const selectedProperty = properties.find((option) => option.value === propertyId)
  const allowedPurposes =
    !selectedProperty || selectedProperty.purpose === "sale_rent"
      ? ["sale", "rent"]
      : [selectedProperty.purpose]

  // Queda de rede ou erro inesperado: o diálogo continua aberto com os campos.
  function onSubmitFailure({ message }: SubmitFailure) {
    draft.saveNow()
    setFormError(message)
  }

  function onSubmit(values: ProposalFormValues) {
    if (readOnly) return

    setFormError(null)
    setDiscountBlock(null)

    runSubmit(async () => {
      const result = editing
        ? await updateProposal(editing.id, values)
        : await createProposal(values)

      if (!result.ok) {
        if ("needsDiscountApproval" in result && result.needsDiscountApproval) {
          setDiscountBlock({ message: result.error, amount: values.amount })
          return
        }

        setFormError(result.error)
        return
      }

      draft.clear()
      toast.add({ title: result.message ?? "Proposta salva.", type: "success" })
      onDone()
    }, onSubmitFailure)
  }

  // O gatilho só barra a edição de proposta ENVIADA (rascunho e contraproposta
  // mudam de valor livremente). E a RPC de pedido mede o valor já gravado, então
  // não dá para pedir antes de salvar: o caminho é registrar a contraproposta,
  // salvar o valor novo e pedir a aprovação antes de reenviar.
  function saveAsCounterOffer(values: ProposalFormValues) {
    if (!editing || readOnly) return

    setFormError(null)

    runSubmit(async () => {
      const countered = await changeProposalStatus(editing.id, "countered")

      if (!countered.ok) {
        // Ex.: alguém já registrou a contraproposta. Sem o bloqueio, o botão volta
        // a ser o "Salvar" normal, que em contraproposta não trava.
        setDiscountBlock(null)
        setFormError(countered.error)
        return
      }

      const saved = await updateProposal(editing.id, values)

      if (!saved.ok) {
        setDiscountBlock(null)
        setFormError(`A contraproposta foi registrada, mas a mudança não foi salva: ${saved.error}`)
        return
      }

      draft.clear()
      toast.add({
        title: "Contraproposta registrada com a mudança.",
        description: "Peça a aprovação do gerente antes de reenviar a proposta.",
        type: "success",
      })
      onDone()
      onDiscountApprovalNeeded?.(editing.id)
    }, onSubmitFailure)
  }

  // Na edição, o campo só aparece quando a lista trouxe a data gravada: sem ela,
  // um campo vazio pareceria "sem data" e salvaria por cima (a aba Previsão de
  // /relatorios também preenche a data).
  const showExpectedCloseDate = !editing || editing.values.expectedCloseDate !== undefined

  const expectedCloseDateField = showExpectedCloseDate ? (
    <Controller
      name="expectedCloseDate"
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
          <FieldLabel htmlFor="proposta-previsao">
            Data prevista de fechamento (opcional)
          </FieldLabel>
          <Input
            {...field}
            value={field.value ?? ""}
            id="proposta-previsao"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            disabled={readOnly}
            aria-invalid={fieldState.invalid}
          />
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : (
            <FieldDescription>Entra na previsão de vendas do mês em Relatórios.</FieldDescription>
          )}
        </Field>
      )}
    />
  ) : null

  const title = editing ? (readOnly ? "Detalhes da proposta" : "Editar proposta") : "Nova proposta"
  const description = editing
    ? (editing.readOnlyReason ??
      "Registre cada contraproposta e cada nova oferta como rodada. Abaixo, atualize imóvel, cliente, corretor e finalidade.")
    : "A proposta começa como rascunho. Depois, marque como enviada quando apresentá-la."

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {/* Fora do <form>: o painel tem o próprio formulário de rodada. */}
      {editing ? (
        <ProposalNegotiationPanel
          proposalId={editing.id}
          readOnly={readOnly}
          onDiscountApprovalNeeded={(proposalId) => {
            onDone()
            onDiscountApprovalNeeded?.(proposalId)
          }}
        />
      ) : null}
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <UnsavedChangesGuard when={!readOnly && isDirty} />
        <FieldGroup>
          <FormDraftNotice draft={draft} />
          {formError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {blockedDiscount ? (
            <Alert variant="destructive">
              <BadgePercentIcon />
              <AlertTitle>Esta mudança precisa da aprovação do gerente</AlertTitle>
              <AlertDescription>
                {blockedDiscount.message} Como a proposta já foi enviada, a mudança entra como
                contraproposta; depois é só pedir a aprovação e reenviar.
              </AlertDescription>
            </Alert>
          ) : null}
          <Controller
            name="propertyId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                <FieldLabel htmlFor="proposta-imovel">Imóvel</FieldLabel>
                <OptionCombobox
                  id="proposta-imovel"
                  options={propertyOptions}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value)
                    const property = properties.find((option) => option.value === value)

                    if (property && property.purpose !== "sale_rent") {
                      form.setValue("purpose", property.purpose, {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                  }}
                  onBlur={field.onBlur}
                  placeholder="Buscar por código ou título"
                  emptyText="Nenhum imóvel encontrado."
                  disabled={readOnly}
                  invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              name="clientId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                  <FieldLabel htmlFor="proposta-cliente">Cliente</FieldLabel>
                  <OptionCombobox
                    id="proposta-cliente"
                    options={clientOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="Buscar pelo nome"
                    emptyText="Nenhum cliente a que você tenha acesso."
                    disabled={readOnly}
                    invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            <Controller
              name="brokerId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  data-disabled={readOnly || brokerLocked || undefined}
                >
                  <FieldLabel htmlFor="proposta-corretor">Corretor</FieldLabel>
                  <Select
                    items={brokerItems}
                    value={field.value || null}
                    onValueChange={(value: string | null) => field.onChange(value ?? "")}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) field.onBlur()
                    }}
                    disabled={readOnly || brokerLocked}
                  >
                    <SelectTrigger
                      id="proposta-corretor"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {brokerItems.map((item) => (
                          <SelectItem key={item.value ?? "sem-corretor"} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : brokerLocked ? (
                    <FieldDescription>
                      Você fica como corretor das propostas que cadastra.
                    </FieldDescription>
                  ) : null}
                </Field>
              )}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              name="purpose"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                  <FieldTitle id="proposta-finalidade">Finalidade</FieldTitle>
                  <ToggleGroup
                    aria-labelledby="proposta-finalidade"
                    variant="outline"
                    value={[field.value]}
                    onValueChange={(value) => {
                      const next = value[0]
                      if (next === "sale" || next === "rent") field.onChange(next)
                    }}
                    disabled={readOnly}
                  >
                    <ToggleGroupItem value="sale" disabled={!allowedPurposes.includes("sale")}>
                      {LISTING_PURPOSE_LABELS.sale}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="rent" disabled={!allowedPurposes.includes("rent")}>
                      {LISTING_PURPOSE_LABELS.rent}
                    </ToggleGroupItem>
                  </ToggleGroup>
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            {/* Na edição, valor e condições mudam por rodada (painel de negociação). */}
            {editing ? null : (
              <Controller
                name="amount"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                    <FieldLabel htmlFor="proposta-valor">Valor</FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>
                        <InputGroupText>R$</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        {...field}
                        id="proposta-valor"
                        inputMode="numeric"
                        placeholder="0,00"
                        disabled={readOnly}
                        aria-invalid={fieldState.invalid}
                        onChange={(event) => field.onChange(maskBrlInput(event.target.value))}
                      />
                    </InputGroup>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            )}
          </div>
          {editing ? null : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Controller
                  name="downPayment"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="proposta-sinal">Sinal (opcional)</FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>
                          <InputGroupText>R$</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          {...field}
                          value={field.value ?? ""}
                          id="proposta-sinal"
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
                <Controller
                  name="financingAmount"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="proposta-financiamento">
                        Financiamento (opcional)
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>
                          <InputGroupText>R$</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          {...field}
                          value={field.value ?? ""}
                          id="proposta-financiamento"
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
              <Controller
                name="exchangeDescription"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="proposta-permuta">Permuta (opcional)</FieldLabel>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      id="proposta-permuta"
                      rows={2}
                      maxLength={1000}
                      placeholder="Ex.: apartamento de 2 quartos no Tatuapé, avaliado em R$ 450 mil"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="paymentDeadline"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="proposta-prazo">Prazo (opcional)</FieldLabel>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      id="proposta-prazo"
                      maxLength={300}
                      placeholder="Ex.: saldo em 60 dias, na escritura"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </>
          )}
          {editing && expectedCloseDateField ? (
            <div className="grid gap-5 sm:grid-cols-2">{expectedCloseDateField}</div>
          ) : null}
          {editing ? null : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Controller
                  name="validUntil"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                      <FieldLabel htmlFor="proposta-validade">Validade (opcional)</FieldLabel>
                      <Input
                        {...field}
                        id="proposta-validade"
                        type="date"
                        disabled={readOnly}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : (
                        <FieldDescription>
                          Depois dessa data, a proposta aparece como vencida.
                        </FieldDescription>
                      )}
                    </Field>
                  )}
                />
                {expectedCloseDateField}
              </div>
              <Controller
                name="paymentTerms"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                    <FieldLabel htmlFor="proposta-pagamento">
                      Forma de pagamento (opcional)
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="proposta-pagamento"
                      rows={3}
                      maxLength={5000}
                      placeholder="Ex.: 30% de entrada e financiamento bancário do restante"
                      disabled={readOnly}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="conditions"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} data-disabled={readOnly || undefined}>
                    <FieldLabel htmlFor="proposta-condicoes">Condições (opcional)</FieldLabel>
                    <Textarea
                      {...field}
                      id="proposta-condicoes"
                      rows={3}
                      maxLength={5000}
                      placeholder="Ex.: desocupação em 60 dias, móveis planejados inclusos"
                      disabled={readOnly}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </>
          )}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {readOnly ? "Fechar" : "Cancelar"}
          </DialogClose>
          {readOnly ? null : blockedDiscount && editing ? (
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => void form.handleSubmit(saveAsCounterOffer)()}
            >
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BadgePercentIcon data-icon="inline-start" />
              )}
              Registrar contraproposta e salvar
            </Button>
          ) : (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              {editing ? "Salvar alterações" : "Criar proposta"}
            </Button>
          )}
        </DialogFooter>
      </form>
    </>
  )
}
