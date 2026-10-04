"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, InfoIcon } from "lucide-react"
import { useForm, useWatch } from "react-hook-form"

import { formatBRL } from "@workspace/core/billing/format"
import {
  COMMISSION_BASIS_LABELS,
  COMMISSION_PURPOSE_LABELS,
  COMMISSION_ROLE_LABELS,
  commissionTotalCents,
  describeSplitImbalance,
  formatPercent,
  splitCommission,
  type CommissionPurpose,
} from "@workspace/core/comissoes"
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

import { MoneyField, PercentField } from "@/components/comissoes/commission-fields"
import { saveCommissionRule } from "@/lib/comissoes/actions"
import { centsToBrlInput, maskBrlInput, parseBrlCents } from "@/lib/comissoes/money"
import { commissionRuleSchema, toSplit, type CommissionRuleValues } from "@/lib/comissoes/schemas"
import type { CommissionRuleRow } from "@/lib/comissoes/queries"

/** Valor de negócio usado na simulação até o gestor digitar outro. */
const PREVIEW_DEFAULTS: Record<CommissionPurpose, number> = {
  sale: 50_000_000,
  rent: 250_000,
}

function toValues(
  purpose: CommissionPurpose,
  rule: CommissionRuleRow | null
): CommissionRuleValues {
  if (!rule) {
    return {
      purpose,
      basis: "percent",
      percent: purpose === "rent" ? 100 : 6,
      fixedAmount: "",
      capturerPercent: 20,
      sellerPercent: 30,
      managerPercent: 10,
      agencyPercent: 40,
      partnerPercent: 0,
      note: "",
    }
  }

  return {
    purpose,
    basis: rule.basis,
    percent: rule.percent,
    fixedAmount: rule.basis === "fixed" ? centsToBrlInput(rule.fixedCents) : "",
    capturerPercent: rule.split.capturer,
    sellerPercent: rule.split.seller,
    managerPercent: rule.split.manager,
    agencyPercent: rule.split.agency,
    partnerPercent: rule.split.partner,
    note: rule.note ?? "",
  }
}

export function CommissionRuleForm({
  purpose,
  rule,
}: {
  purpose: CommissionPurpose
  rule: CommissionRuleRow | null
}) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [previewInput, setPreviewInput] = React.useState(() =>
    centsToBrlInput(PREVIEW_DEFAULTS[purpose])
  )

  const form = useForm<CommissionRuleValues>({
    resolver: zodResolver(commissionRuleSchema),
    mode: "onTouched",
    defaultValues: toValues(purpose, rule),
  })

  const values = useWatch({ control: form.control })
  const basis = values.basis ?? "percent"

  const split = toSplit({
    capturerPercent: values.capturerPercent ?? 0,
    sellerPercent: values.sellerPercent ?? 0,
    managerPercent: values.managerPercent ?? 0,
    agencyPercent: values.agencyPercent ?? 0,
    partnerPercent: values.partnerPercent ?? 0,
  })
  const imbalance = describeSplitImbalance(split)

  // Simulação com as MESMAS funções do core que o banco espelha.
  const previewDealCents = parseBrlCents(previewInput) ?? 0
  const previewTotal = commissionTotalCents(
    {
      purpose,
      basis,
      percent: values.percent ?? 0,
      fixedCents: parseBrlCents(values.fixedAmount ?? "") ?? 0,
      split,
    },
    previewDealCents
  )
  const previewShares = imbalance
    ? []
    : splitCommission(previewTotal, split, {
        capturer: "captacao",
        seller: "atendimento",
        manager: "gerencia",
        partner: (values.partnerPercent ?? 0) > 0 ? "parceiro" : null,
      })

  function onSubmit(nextValues: CommissionRuleValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await saveCommissionRule(nextValues)

      if (result.ok) {
        toast.add({ title: result.message ?? "Tabela salva.", type: "success" })
        form.reset(nextValues)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof CommissionRuleValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  const basisItems = [
    { value: "percent", label: COMMISSION_BASIS_LABELS.percent },
    { value: "fixed", label: COMMISSION_BASIS_LABELS.fixed },
  ]

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
          <FieldLegend>Quanto a imobiliária cobra</FieldLegend>
          <FieldDescription>
            {purpose === "sale"
              ? "Percentual sobre o valor da venda ou um valor fixo por negócio."
              : "Costuma ser 100% do primeiro aluguel. Também aceita um valor fixo."}
          </FieldDescription>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`base-${purpose}`}>Base de cálculo</FieldLabel>
              <Select
                items={basisItems}
                value={basis}
                onValueChange={(value) => {
                  if (value === "percent" || value === "fixed") {
                    form.setValue("basis", value, { shouldDirty: true })
                  }
                }}
              >
                <SelectTrigger id={`base-${purpose}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {basisItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>O valor fixo nunca passa do valor do negócio.</FieldDescription>
            </Field>

            {basis === "percent" ? (
              <PercentField
                control={form.control}
                name="percent"
                id={`percentual-${purpose}`}
                label="Percentual do negócio"
                description="Até três casas decimais (ex.: 6, 6,5 ou 5,875)."
              />
            ) : (
              <MoneyField
                control={form.control}
                name="fixedAmount"
                id={`fixo-${purpose}`}
                label="Valor fixo por negócio"
                description="Guardado em centavos inteiros: nada de arredondamento escondido."
              />
            )}
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Como a comissão é dividida</FieldLegend>
          <FieldDescription>
            Os cinco percentuais precisam somar exatamente 100%. Papel sem pessoa no negócio (sem
            captador, sem gerente escolhido ou sem parceiro) tem a parte dele somada à da
            imobiliária.
          </FieldDescription>

          <div className="grid gap-5 sm:grid-cols-2 @min-[40rem]/main:grid-cols-3">
            <PercentField
              control={form.control}
              name="capturerPercent"
              id={`captacao-${purpose}`}
              label={COMMISSION_ROLE_LABELS.capturer}
              description="Quem captou o imóvel."
            />
            <PercentField
              control={form.control}
              name="sellerPercent"
              id={`atendimento-${purpose}`}
              label={COMMISSION_ROLE_LABELS.seller}
              description="Quem atendeu o cliente."
            />
            <PercentField
              control={form.control}
              name="managerPercent"
              id={`gerencia-${purpose}`}
              label={COMMISSION_ROLE_LABELS.manager}
              description="O gerente escolhido nos ajustes."
            />
            <PercentField
              control={form.control}
              name="agencyPercent"
              id={`imobiliaria-${purpose}`}
              label={COMMISSION_ROLE_LABELS.agency}
              description="Também recebe a sobra de centavos do rateio."
            />
            <PercentField
              control={form.control}
              name="partnerPercent"
              id={`parceiro-${purpose}`}
              label={COMMISSION_ROLE_LABELS.partner}
              description="Deixe em 0 e registre o parceiro negócio a negócio."
            />
          </div>

          {imbalance ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>A divisão não fecha 100%</AlertTitle>
              <AlertDescription>{imbalance}</AlertDescription>
            </Alert>
          ) : null}
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Simulação</FieldLegend>
          <FieldDescription>
            A conta abaixo é a mesma que o banco faz quando a proposta é aceita.
          </FieldDescription>

          <Field>
            <FieldLabel htmlFor={`simulacao-${purpose}`}>
              {purpose === "sale" ? "Valor da venda" : "Valor do aluguel"}
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <InputGroupText>R$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id={`simulacao-${purpose}`}
                inputMode="numeric"
                autoComplete="off"
                value={previewInput}
                onChange={(event) => setPreviewInput(maskBrlInput(event.target.value))}
              />
            </InputGroup>
          </Field>

          <Alert>
            <InfoIcon />
            <AlertTitle>
              Comissão de {formatBRL(previewTotal)} em um negócio de {formatBRL(previewDealCents)}
            </AlertTitle>
            <AlertDescription>
              {previewShares.length === 0 ? (
                <p>Feche a divisão em 100% para ver o rateio.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {previewShares.map((share) => (
                    <li key={share.role}>
                      {COMMISSION_ROLE_LABELS[share.role]}: {formatBRL(share.amountCents)} (
                      {formatPercent(share.percent)})
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        </FieldSet>

        <Field>
          <FieldLabel htmlFor={`observacao-${purpose}`}>Observação (opcional)</FieldLabel>
          <Textarea
            id={`observacao-${purpose}`}
            rows={2}
            maxLength={500}
            placeholder="Ex.: acordo válido a partir de janeiro."
            {...form.register("note")}
          />
          <FieldDescription>
            Fica registrada com a versão e ajuda a lembrar por que a tabela mudou.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar tabela de {COMMISSION_PURPOSE_LABELS[purpose].toLowerCase()}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
