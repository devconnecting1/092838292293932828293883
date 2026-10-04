"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { BadgePercentIcon, CircleAlertIcon, HistoryIcon, PlusIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { formatBRL } from "@workspace/core/billing/format"
import {
  allowedRoundKinds,
  describeRoundTerms,
  formatRoundTitle,
  PROPOSAL_ROUND_KIND_LABELS,
  type ProposalRoundKind,
} from "@workspace/core/proposals/rounds"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
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
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { formatDateOnly } from "@/lib/chaves/datetime"
import { formatDateTime } from "@/lib/format"
import { amountToBrlInput, maskBrlInput } from "@/lib/propostas/money"
import {
  getProposalNegotiation,
  registerProposalRound,
  type ProposalNegotiation,
  type ProposalRoundView,
} from "@/lib/propostas/round-actions"
import { proposalRoundSchema, type ProposalRoundValues } from "@/lib/propostas/schemas"

function money(value: number) {
  return formatBRL(Math.round(value * 100))
}

function roundDetails(round: ProposalRoundView) {
  return [
    ...describeRoundTerms(round, money),
    ...(round.paymentTerms ? [{ label: "Forma de pagamento", value: round.paymentTerms }] : []),
    ...(round.conditions ? [{ label: "Condições", value: round.conditions }] : []),
    ...(round.validUntil ? [{ label: "Validade", value: formatDateOnly(round.validUntil) }] : []),
  ]
}

function roundAuthor(round: ProposalRoundView) {
  return `Registrada${round.authorName ? ` por ${round.authorName}` : ""} em ${formatDateTime(round.createdAt)}`
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
  error,
  disabled,
  description,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  invalid: boolean
  error?: { message?: string }
  disabled: boolean
  description?: string
}) {
  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>R$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          value={value}
          inputMode="numeric"
          placeholder="0,00"
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => onChange(maskBrlInput(event.target.value))}
          onBlur={onBlur}
        />
      </InputGroup>
      {invalid ? (
        <FieldError errors={[error]} />
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

function RoundForm({
  proposalId,
  kinds,
  current,
  onCancel,
  onSaved,
  onDiscountApprovalNeeded,
}: {
  proposalId: string
  kinds: ProposalRoundKind[]
  current: ProposalRoundView | null
  onCancel: () => void
  onSaved: () => void
  onDiscountApprovalNeeded?: (proposalId: string) => void
}) {
  const [formError, setFormError] = React.useState<string | null>(null)
  const [discountBlock, setDiscountBlock] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ProposalRoundValues>({
    resolver: zodResolver(proposalRoundSchema),
    mode: "onTouched",
    defaultValues: {
      kind: kinds.length === 1 ? kinds[0] : undefined,
      amount: amountToBrlInput(current?.amount),
      downPayment: amountToBrlInput(current?.downPayment),
      financingAmount: amountToBrlInput(current?.financingAmount),
      exchangeDescription: current?.exchangeDescription ?? "",
      paymentDeadline: current?.paymentDeadline ?? "",
      paymentTerms: current?.paymentTerms ?? "",
      conditions: current?.conditions ?? "",
      validUntil: current?.validUntil ?? "",
    },
  })

  const kind = useWatch({ control: form.control, name: "kind" })

  function save(values: ProposalRoundValues, holdForApproval: boolean) {
    setFormError(null)

    startTransition(async () => {
      const result = await registerProposalRound(proposalId, values, { holdForApproval })

      if (!result.ok) {
        if (result.needsDiscountApproval && values.kind === "client_offer") {
          setDiscountBlock(result.error)
          return
        }

        setDiscountBlock(null)
        setFormError(result.error)
        return
      }

      toast.add({ title: result.message, type: "success" })

      if (holdForApproval) {
        onDiscountApprovalNeeded?.(proposalId)
        return
      }

      onSaved()
    })
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => save(values, false))}
      noValidate
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível registrar a rodada</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        {discountBlock && kind === "client_offer" ? (
          <Alert variant="destructive">
            <BadgePercentIcon />
            <AlertTitle>Esta oferta precisa da aprovação do gerente</AlertTitle>
            <AlertDescription>
              {discountBlock} Salve a oferta aguardando aprovação: ela entra no histórico e a
              proposta só volta a ser enviada depois do aceite do gerente.
            </AlertDescription>
          </Alert>
        ) : null}

        <Controller
          name="kind"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldTitle id="rodada-tipo">Quem propôs</FieldTitle>
              <ToggleGroup
                aria-labelledby="rodada-tipo"
                variant="outline"
                className="flex-wrap"
                value={field.value ? [field.value] : []}
                onValueChange={(value) => {
                  const next = value[0]
                  if (next && kinds.includes(next as ProposalRoundKind)) {
                    field.onChange(next)
                    setDiscountBlock(null)
                  }
                }}
                disabled={isPending}
              >
                {kinds.map((item) => (
                  <ToggleGroupItem key={item} value={item}>
                    {item === "initial"
                      ? "Corrigir proposta inicial"
                      : PROPOSAL_ROUND_KIND_LABELS[item]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <MoneyField
                id="rodada-valor"
                label="Valor"
                value={field.value}
                onChange={(value) => {
                  field.onChange(value)
                  setDiscountBlock(null)
                }}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                disabled={isPending}
              />
            )}
          />
          <Controller
            name="downPayment"
            control={form.control}
            render={({ field, fieldState }) => (
              <MoneyField
                id="rodada-sinal"
                label="Sinal (opcional)"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                disabled={isPending}
              />
            )}
          />
          <Controller
            name="financingAmount"
            control={form.control}
            render={({ field, fieldState }) => (
              <MoneyField
                id="rodada-financiamento"
                label="Financiamento (opcional)"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                disabled={isPending}
              />
            )}
          />
          <Controller
            name="validUntil"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="rodada-validade">Validade (opcional)</FieldLabel>
                <Input
                  {...field}
                  id="rodada-validade"
                  type="date"
                  disabled={isPending}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>

        <Controller
          name="exchangeDescription"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="rodada-permuta">Permuta (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="rodada-permuta"
                rows={2}
                maxLength={1000}
                placeholder="Ex.: apartamento de 2 quartos no Tatuapé, avaliado em R$ 450 mil"
                disabled={isPending}
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
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="rodada-prazo">Prazo (opcional)</FieldLabel>
              <Input
                {...field}
                id="rodada-prazo"
                maxLength={300}
                placeholder="Ex.: saldo em 60 dias, na escritura"
                disabled={isPending}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="paymentTerms"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="rodada-pagamento">Forma de pagamento (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="rodada-pagamento"
                rows={2}
                maxLength={5000}
                disabled={isPending}
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
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="rodada-condicoes">Condições (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="rodada-condicoes"
                rows={2}
                maxLength={5000}
                disabled={isPending}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
        {discountBlock && kind === "client_offer" ? (
          <Button
            type="button"
            disabled={isPending}
            onClick={() => void form.handleSubmit((values) => save(values, true))()}
          >
            {isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <BadgePercentIcon data-icon="inline-start" />
            )}
            Salvar e pedir aprovação
          </Button>
        ) : (
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Registrar rodada
          </Button>
        )}
      </div>
    </form>
  )
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProposalNegotiation }

/**
 * Negociação da proposta: rodada vigente, registro de nova rodada e linha do
 * tempo. As rodadas são imutáveis no banco; mudar valor ou condição é sempre
 * registrar uma rodada nova.
 */
export function ProposalNegotiationPanel({
  proposalId,
  readOnly,
  onDiscountApprovalNeeded,
}: {
  proposalId: string
  readOnly: boolean
  onDiscountApprovalNeeded?: (proposalId: string) => void
}) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" })
  const [formOpen, setFormOpen] = React.useState(false)
  const [, startLoading] = React.useTransition()

  const load = React.useCallback(() => {
    startLoading(async () => {
      const result = await getProposalNegotiation(proposalId)
      setState(
        result.ok
          ? { status: "ready", data: result.data }
          : { status: "error", message: result.error }
      )
    })
  }, [proposalId])

  React.useEffect(() => {
    load()
  }, [load])

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Negociação indisponível</AlertTitle>
        <AlertDescription>
          <p>{state.message}</p>
          <Button variant="outline" size="sm" onClick={load}>
            Tentar de novo
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const { data } = state
  const [current, ...previous] = data.rounds
  const kinds = readOnly ? [] : allowedRoundKinds(data.status)
  const suffix = data.purpose === "rent" ? "/mês" : ""

  return (
    <section className="flex flex-col gap-4" aria-labelledby="negociacao-titulo">
      <div className="flex flex-col gap-1">
        <h3 id="negociacao-titulo" className="font-medium">
          Negociação
        </h3>
        <p className="text-sm text-muted-foreground">
          Cada contraproposta e cada nova oferta vira uma rodada. O histórico não pode ser alterado.
        </p>
      </div>

      {current ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Rodada vigente</Badge>
            <span className="text-sm font-medium">
              {formatRoundTitle(current.number, current.kind)}
            </span>
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            {money(current.amount)}
            {suffix ? (
              <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
            ) : null}
          </p>
          {roundDetails(current).length > 0 ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {roundDetails(current).map((line) => (
                <div key={line.label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{line.label}</dt>
                  <dd className="text-sm wrap-break-word whitespace-pre-line">{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="text-xs text-muted-foreground">{roundAuthor(current)}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma rodada registrada ainda.</p>
      )}

      {kinds.length > 0 ? (
        formOpen ? (
          <RoundForm
            proposalId={proposalId}
            kinds={kinds}
            current={current ?? null}
            onCancel={() => setFormOpen(false)}
            onSaved={() => {
              setFormOpen(false)
              load()
            }}
            onDiscountApprovalNeeded={onDiscountApprovalNeeded}
          />
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setFormOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            {data.status === "draft" ? "Corrigir valores da proposta" : "Registrar nova rodada"}
          </Button>
        )
      ) : null}

      {previous.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Separator />
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            Rodadas anteriores
          </h4>
          <ItemGroup className="gap-2">
            {previous.map((round) => {
              const details = roundDetails(round)

              return (
                <Item key={round.number} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="flex-wrap">
                      {formatRoundTitle(round.number, round.kind)}
                      <span className="tabular-nums">
                        {money(round.amount)}
                        {suffix}
                      </span>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {details.map((line) => `${line.label}: ${line.value}`).join(" · ")}
                      {details.length > 0 ? " · " : ""}
                      {roundAuthor(round)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              )
            })}
          </ItemGroup>
        </div>
      ) : null}
    </section>
  )
}
