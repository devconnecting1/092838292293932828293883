"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, ImagePlusIcon } from "lucide-react"

import {
  BILLING_INTERVAL_LABELS,
  formatBRL,
  MAX_OWNED_LISTING_PACKS,
  OWNED_LISTINGS_PACK_SIZE,
  type BillingInterval,
  type PlanKey,
} from "@workspace/core/billing"
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
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { pluralize } from "@/components/billing/plan-content"
import { parseQuantity, QuantityStepper } from "@/components/billing/quantity-stepper"
import { changeSubscription } from "@/lib/billing/actions"
import { formatDate } from "@/lib/format"

type OwnedListingPacksDialogProps = {
  planKey: PlanKey
  planName: string
  interval: BillingInterval
  extraSeats: number
  currentPacks: number
  /** Imóveis com foto incluídos no plano, sem pacotes. */
  planListings: number
  /** Centavos por pacote no ciclo da assinatura. */
  packPrice: number
  /** Imóveis com foto que contam hoje; null = não deu para ler. */
  ownedListingsInUse: number | null
  currentPeriodEnd: string | null
  disabled?: boolean
}

/**
 * Compra e remoção dos pacotes de +10 imóveis na tela de Assinatura: mesmo
 * plano, ciclo e usuários, só a quantidade de pacotes muda (changeSubscription).
 * Aumento vale na hora com cobrança proporcional; redução, no fim do ciclo.
 */
export function OwnedListingPacksDialog({
  planKey,
  planName,
  interval,
  extraSeats,
  currentPacks,
  planListings,
  packPrice,
  ownedListingsInUse,
  currentPeriodEnd,
  disabled = false,
}: OwnedListingPacksDialogProps) {
  const router = useRouter()
  const inputId = React.useId()
  const hintId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState(String(currentPacks))
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const packs = parseQuantity(value, MAX_OWNED_LISTING_PACKS)
  const suffix = BILLING_INTERVAL_LABELS[interval].suffix
  const limit = planListings + packs * OWNED_LISTINGS_PACK_SIZE
  const unchanged = packs === currentPacks
  const increase = packs > currentPacks
  const belowUsage = ownedListingsInUse !== null && limit < ownedListingsInUse

  function handleOpenChange(next: boolean) {
    if (pending) {
      return
    }

    if (next) {
      setValue(String(currentPacks))
      setError(null)
    }

    setOpen(next)
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await changeSubscription({
          planKey,
          interval,
          extraSeats,
          ownedListingPacks: packs,
        })

        if (!result.ok) {
          setError(result.error)
          return
        }

        toast.add(
          result.effective === "now"
            ? {
                type: "success",
                title: "Pacotes atualizados",
                description: `O limite passa a ${pluralize(limit, "imóvel com foto", "imóveis com foto")} assim que o pagamento for confirmado.`,
              }
            : {
                type: "success",
                title: "Redução agendada",
                description: `Vale a partir de ${formatDate(currentPeriodEnd)}. Até lá, o limite atual continua.`,
              }
        )
        setOpen(false)
        router.refresh()
      } catch {
        setError("Não foi possível falar com o servidor. Tente de novo em instantes.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        <ImagePlusIcon data-icon="inline-start" />
        {currentPacks > 0 ? "Alterar imóveis extras" : "Comprar +10 imóveis"}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Imóveis com foto extras</DialogTitle>
          <DialogDescription>
            Cada pacote soma {OWNED_LISTINGS_PACK_SIZE} imóveis com foto ao plano {planName}, por{" "}
            {formatBRL(packPrice, { omitZeroCents: true })}
            {suffix}.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor={inputId}>Pacotes de +{OWNED_LISTINGS_PACK_SIZE} imóveis</FieldLabel>
          <QuantityStepper
            id={inputId}
            value={value}
            quantity={packs}
            max={MAX_OWNED_LISTING_PACKS}
            disabled={pending}
            itemLabel="pacote de imóveis"
            onValueChange={setValue}
            describedBy={hintId}
          />
          <FieldDescription id={hintId}>
            {pluralize(planListings, "imóvel incluído", "imóveis incluídos")} no plano
            {packs > 0
              ? ` + ${packs * OWNED_LISTINGS_PACK_SIZE} dos pacotes = ${pluralize(limit, "imóvel com foto", "imóveis com foto")}`
              : ""}
            .
            {ownedListingsInUse !== null
              ? ` Hoje ${ownedListingsInUse === 1 ? "conta" : "contam"} ${pluralize(ownedListingsInUse, "imóvel", "imóveis")}.`
              : ""}
          </FieldDescription>
        </Field>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Pacotes</dt>
          <dd className="text-end tabular-nums">
            {packs} × {formatBRL(packPrice, { omitZeroCents: true })}
            {suffix}
          </dd>
          <dt className="font-medium">Total dos pacotes</dt>
          <dd className="text-end font-medium tabular-nums">
            {formatBRL(packs * packPrice, { omitZeroCents: true })}
            {suffix}
          </dd>
        </dl>

        <ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground">
          {increase ? (
            <li>
              Mais pacotes valem na hora: cobramos hoje a diferença proporcional ao tempo que falta
              no ciclo.
            </li>
          ) : null}
          {!increase && !unchanged ? (
            <li>
              Menos pacotes valem no fim do ciclo
              {currentPeriodEnd ? ` (${formatDate(currentPeriodEnd)})` : ""}. Até lá, nada muda.
            </li>
          ) : null}
          <li>Nenhum imóvel ou foto é apagado.</li>
        </ul>

        {belowUsage && !increase ? (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Limite abaixo do uso</AlertTitle>
            <AlertDescription>
              Com {pluralize(limit, "imóvel", "imóveis")} no limite e {ownedListingsInUse} em uso,
              os imóveis atuais continuam no ar, mas a foto de um imóvel novo fica bloqueada até
              você marcar como vendido, alugado ou inativo os que saíram da carteira.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível mudar os pacotes</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={pending}>
            Voltar
          </DialogClose>
          <Button type="button" onClick={confirm} disabled={pending || unchanged}>
            {pending ? <Spinner data-icon="inline-start" aria-label="Aguarde" /> : null}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
