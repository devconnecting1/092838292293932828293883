"use client"

import * as React from "react"
import Link from "next/link"
import {
  BadgeCheckIcon,
  BadgePercentIcon,
  CircleAlertIcon,
  HourglassIcon,
  SendIcon,
  XCircleIcon,
} from "lucide-react"

import { formatBRL } from "@workspace/core/billing/format"
import { formatPercent } from "@workspace/core/comissoes"
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
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { requestProposalDiscount } from "@/lib/comissoes/actions"
import { COMMISSIONS_PATH } from "@/lib/comissoes/permissions"
import { formatDateTime } from "@/lib/format"
import type { ProposalDiscount } from "@/lib/propostas/discount"

/** Tamanho máximo da justificativa (check da coluna `reason` no banco). */
const REASON_MAX_LENGTH = 1000

/** O que a tela de propostas sabe sobre o desconto de uma proposta. */
export type DiscountApprovalTarget = {
  proposalId: string
  /** "AP-0012 · Maria Silva", para o cabeçalho do diálogo. */
  title: string
  /** null quando a lista não conseguiu medir (imóvel oculto, ajustes indisponíveis). */
  discount: ProposalDiscount | null
  /**
   * Recusa que acabou de vir do gatilho do banco. Com ela o formulário sempre
   * aparece, mesmo que a lista (ainda) mostre o desconto como aprovado.
   */
  blockedMessage: string | null
  /** Corretor da proposta ou quem edita o imóvel (mesma regra da RPC). */
  canRequest: boolean
  /** Dono ou gerente: responde o pedido em Comissões. */
  canReview: boolean
}

/**
 * Validação da justificativa antes de enviar. Devolve a mensagem de erro ou
 * `null` quando pode seguir. O banco aceita justificativa vazia; o que exigir
 * além disso é decisão da imobiliária.
 */
export function validateDiscountReason(reason: string): string | null {
  if (reason.trim().length > REASON_MAX_LENGTH) {
    return `A justificativa pode ter no máximo ${REASON_MAX_LENGTH} caracteres.`
  }

  return null
}

export function DiscountApprovalDialog({
  target,
  open,
  onOpenChange,
}: {
  target: DiscountApprovalTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remonta por proposta: a justificativa de uma não vaza para a outra. */}
        {target ? (
          <DiscountApprovalContent
            key={target.proposalId}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DiscountSummary({ discount }: { discount: ProposalDiscount }) {
  return (
    <dl className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm">
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-muted-foreground">Proposta</dt>
        <dd className="font-medium tabular-nums">{formatBRL(discount.amountCents)}</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-muted-foreground">Anunciado</dt>
        <dd className="font-medium tabular-nums">{formatBRL(discount.referenceCents)}</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-muted-foreground">Desconto</dt>
        <dd className="font-medium tabular-nums">
          {formatPercent(discount.percent)}
          <span className="font-normal text-muted-foreground">
            {" "}
            (limite {formatPercent(discount.limitPercent)})
          </span>
        </dd>
      </div>
    </dl>
  )
}

/** Situação do último pedido, quando ele não libera a proposta. */
function LatestRequestNotice({ discount }: { discount: ProposalDiscount }) {
  const latest = discount.latestRequest

  if (!latest) {
    return null
  }

  if (latest.status === "pending") {
    const outdated =
      latest.amountCents !== discount.amountCents ||
      latest.referenceCents !== discount.referenceCents

    return (
      <Alert>
        <HourglassIcon />
        <AlertTitle>Pedido com o gerente</AlertTitle>
        <AlertDescription>
          {outdated
            ? `Pedido feito em ${formatDateTime(latest.createdAt)} para ${formatBRL(latest.amountCents)} sobre ${formatBRL(latest.referenceCents)} anunciados. O valor ou o preço anunciado mudou depois disso: envie de novo para o gerente avaliar a proposta atual.`
            : `Pedido feito em ${formatDateTime(latest.createdAt)}. Enviar de novo só atualiza a justificativa.`}
        </AlertDescription>
      </Alert>
    )
  }

  if (latest.status === "rejected") {
    return (
      <Alert variant="destructive">
        <XCircleIcon />
        <AlertTitle>O gerente recusou este desconto</AlertTitle>
        <AlertDescription>
          {latest.reviewNote ? `“${latest.reviewNote}” ` : ""}
          Ajuste o valor da proposta ou peça de novo com outra justificativa.
        </AlertDescription>
      </Alert>
    )
  }

  // Aprovado, mas não cobre mais: o valor baixou ou o preço anunciado subiu (outro
  // imóvel, outra finalidade ou anúncio reajustado).
  const priceRose = latest.amountCents <= discount.amountCents

  return (
    <Alert>
      <CircleAlertIcon />
      <AlertTitle>A aprovação não cobre a proposta atual</AlertTitle>
      <AlertDescription>
        {priceRose
          ? `O gerente aprovou ${formatBRL(latest.amountCents)} sobre ${formatBRL(latest.referenceCents)} anunciados. Com o preço anunciado maior, o desconto cresceu e precisa de outra aprovação.`
          : `O gerente aprovou ${formatBRL(latest.amountCents)}. Com o valor mais baixo, a proposta precisa de outra aprovação.`}
      </AlertDescription>
    </Alert>
  )
}

function DiscountApprovalContent({
  target,
  onDone,
}: {
  target: DiscountApprovalTarget
  onDone: () => void
}) {
  const { discount } = target
  const pending = discount?.latestRequest?.status === "pending" ? discount.latestRequest : null
  // A RPC grava a justificativa enviada por cima da anterior: o campo começa com ela.
  const [reason, setReason] = React.useState(pending?.reason ?? "")
  const [reasonError, setReasonError] = React.useState<string | null>(null)
  const [isSending, startSending] = React.useTransition()

  const approved = Boolean(discount?.approved) && !target.blockedMessage

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const problem = validateDiscountReason(reason)

    if (problem) {
      setReasonError(problem)
      return
    }

    setReasonError(null)

    startSending(async () => {
      const result = await requestProposalDiscount({ proposalId: target.proposalId, reason })

      if (!result.ok) {
        if (result.fieldErrors?.reason) {
          setReasonError(result.fieldErrors.reason)
        }

        toast.add({
          title: "Não foi possível pedir a aprovação",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Pedido enviado ao gerente.", type: "success" })
      onDone()
    })
  }

  // Pedido em aberto de outra pessoa: o banco recusa pedido novo até o gerente
  // responder, então aqui só se mostra a situação.
  if (discount?.pendingByOther && discount.latestRequest) {
    const request = discount.latestRequest

    return (
      <>
        <DialogHeader>
          <DialogTitle>Pedido de desconto em aberto</DialogTitle>
          <DialogDescription>{target.title}.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <DiscountSummary discount={discount} />
          <Alert>
            <HourglassIcon />
            <AlertTitle>Outra pessoa da equipe já pediu a aprovação</AlertTitle>
            <AlertDescription>
              Pedido feito em {formatDateTime(request.createdAt)}
              {request.amountCents !== discount.amountCents
                ? ` para ${formatBRL(request.amountCents)}`
                : ""}
              {target.canReview
                ? ". Responda o pedido em Comissões."
                : ". Assim que o gerente responder, a situação aparece aqui."}
            </AlertDescription>
          </Alert>
        </FieldGroup>
        <DialogFooter>
          {target.canReview ? (
            <>
              <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
              <Button render={<Link href={COMMISSIONS_PATH} />} nativeButton={false}>
                Abrir Comissões
              </Button>
            </>
          ) : (
            <DialogClose render={<Button />}>Fechar</DialogClose>
          )}
        </DialogFooter>
      </>
    )
  }

  if (approved && discount) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Desconto aprovado</DialogTitle>
          <DialogDescription>{target.title}.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <DiscountSummary discount={discount} />
          <Alert>
            <BadgeCheckIcon />
            <AlertTitle>O gerente aprovou este desconto</AlertTitle>
            <AlertDescription>
              A proposta pode ser enviada e aceita por {formatBRL(discount.amountCents)}. Se o valor
              baixar, vai precisar de outra aprovação.
            </AlertDescription>
          </Alert>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button />}>Fechar</DialogClose>
        </DialogFooter>
      </>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>Pedir aprovação do gerente</DialogTitle>
        <DialogDescription>
          {target.title}.{" "}
          {discount
            ? `Desconto acima de ${formatPercent(discount.limitPercent)} só é enviado ou aceito com a aprovação do gerente.`
            : "O desconto desta proposta precisa da aprovação do gerente para seguir."}{" "}
          O gerente responde em Comissões.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {target.blockedMessage ? (
          <Alert variant="destructive">
            <BadgePercentIcon />
            <AlertTitle>O envio foi barrado pelo limite de desconto</AlertTitle>
            <AlertDescription>{target.blockedMessage}</AlertDescription>
          </Alert>
        ) : null}

        {discount ? <DiscountSummary discount={discount} /> : null}
        {discount ? <LatestRequestNotice discount={discount} /> : null}

        {target.canRequest ? (
          <Field
            data-invalid={reasonError ? true : undefined}
            data-disabled={isSending || undefined}
          >
            <FieldLabel htmlFor="desconto-justificativa">Justificativa</FieldLabel>
            <Textarea
              id="desconto-justificativa"
              rows={3}
              maxLength={REASON_MAX_LENGTH}
              placeholder="Ex.: pagamento à vista e imóvel anunciado há oito meses"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={isSending}
              aria-invalid={reasonError ? true : undefined}
            />
            {reasonError ? (
              <FieldError>{reasonError}</FieldError>
            ) : (
              <FieldDescription>
                O gerente lê antes de decidir. Contexto do cliente e do imóvel ajuda a aprovar.
              </FieldDescription>
            )}
          </Field>
        ) : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Sem permissão para pedir</AlertTitle>
            <AlertDescription>
              Só o corretor da proposta ou quem edita o imóvel pode pedir a aprovação do desconto.
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={isSending} />}>
          {target.canRequest ? "Cancelar" : "Fechar"}
        </DialogClose>
        {target.canRequest ? (
          <Button type="submit" disabled={isSending}>
            {isSending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SendIcon data-icon="inline-start" />
            )}
            {pending ? "Atualizar pedido" : "Pedir aprovação do gerente"}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  )
}
