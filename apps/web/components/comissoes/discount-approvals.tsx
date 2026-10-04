"use client"

import * as React from "react"
import Link from "next/link"
import { CheckIcon, SendIcon, XIcon } from "lucide-react"

import { formatBRL } from "@workspace/core/billing/format"
import {
  DISCOUNT_REQUEST_STATUS_LABELS,
  formatPercent,
  type DiscountRequestStatus,
} from "@workspace/core/comissoes"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { requestProposalDiscount, reviewProposalDiscount } from "@/lib/comissoes/actions"
import type { DiscountRequestRow, ProposalNeedingApproval } from "@/lib/comissoes/queries"

const STATUS_VARIANT: Record<DiscountRequestStatus, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
}

function dealLabel(code: string | null, title: string | null) {
  return [code, title].filter(Boolean).join(" · ") || "Imóvel removido"
}

/** Lista do gerente: pedidos esperando resposta. */
export function DiscountRequestsList({
  requests,
  canReview,
  names,
}: {
  requests: readonly DiscountRequestRow[]
  canReview: boolean
  /** Nome por id de usuário: função não atravessa a fronteira servidor/cliente. */
  names: Record<string, string>
}) {
  const nameOf = (userId: string | null) => (userId ? (names[userId] ?? "Ex-membro") : "—")

  const [isPending, startTransition] = React.useTransition()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<Record<string, string>>({})

  function review(requestId: string, approve: boolean) {
    setBusyId(requestId)

    startTransition(async () => {
      const result = await reviewProposalDiscount({
        requestId,
        approve,
        note: notes[requestId] ?? "",
      })
      setBusyId(null)

      if (result.ok) {
        toast.add({ title: result.message ?? "Pedido respondido.", type: "success" })
        return
      }

      toast.add({
        title: "Não foi possível responder",
        description: result.error,
        type: "error",
      })
    })
  }

  if (requests.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum pedido de desconto</EmptyTitle>
          <EmptyDescription>
            Quando um corretor pedir para vender abaixo do limite, o pedido aparece aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {requests.map((request) => (
        <li key={request.id} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium">
                {dealLabel(request.propertyCode, request.propertyTitle)}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatBRL(request.amountCents)} — {formatPercent(request.discountPercent)} abaixo
                do anunciado ({formatBRL(request.referenceCents)})
              </span>
              <span className="text-xs text-muted-foreground">
                Pedido por {nameOf(request.requestedBy)}
                {request.reviewedBy ? ` · respondido por ${nameOf(request.reviewedBy)}` : ""}
              </span>
              {request.reason ? <p className="text-sm">“{request.reason}”</p> : null}
              {request.reviewNote ? (
                <p className="text-sm text-muted-foreground">Resposta: {request.reviewNote}</p>
              ) : null}
            </div>
            <Badge variant={STATUS_VARIANT[request.status]}>
              {DISCOUNT_REQUEST_STATUS_LABELS[request.status]}
            </Badge>
          </div>

          {canReview && request.status === "pending" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label="Observação da resposta"
                placeholder="Observação (opcional)"
                maxLength={1000}
                value={notes[request.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                }
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={isPending} onClick={() => review(request.id, true)}>
                  {isPending && busyId === request.id ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                  Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => review(request.id, false)}
                >
                  <XIcon data-icon="inline-start" />
                  Recusar
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** Propostas abertas que o banco vai barrar por desconto, com o botão de pedir. */
export function ProposalsNeedingApproval({
  proposals,
}: {
  proposals: readonly ProposalNeedingApproval[]
}) {
  const [isPending, startTransition] = React.useTransition()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [reasons, setReasons] = React.useState<Record<string, string>>({})

  function request(proposalId: string) {
    setBusyId(proposalId)

    startTransition(async () => {
      const result = await requestProposalDiscount({
        proposalId,
        reason: reasons[proposalId] ?? "",
      })
      setBusyId(null)

      if (result.ok) {
        toast.add({ title: result.message ?? "Pedido enviado.", type: "success" })
        return
      }

      toast.add({
        title: "Não foi possível pedir a aprovação",
        description: result.error,
        type: "error",
      })
    })
  }

  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma proposta aberta está abaixo do limite. Quando estiver, ela aparece aqui antes de
        travar no envio.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {proposals.map((proposal) => (
        <li key={proposal.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">
                {dealLabel(proposal.propertyCode, proposal.propertyTitle)}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatBRL(proposal.amountCents)} — {formatPercent(proposal.discountPercent)} abaixo
                de {formatBRL(proposal.referenceCents)}
              </span>
            </div>
            {proposal.requestStatus ? (
              <Badge variant={STATUS_VARIANT[proposal.requestStatus]}>
                {DISCOUNT_REQUEST_STATUS_LABELS[proposal.requestStatus]}
              </Badge>
            ) : null}
          </div>

          {proposal.requestStatus === "pending" ? null : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label="Justificativa do desconto"
                placeholder="Por que vale a pena (opcional)"
                maxLength={1000}
                value={reasons[proposal.id] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({ ...current, [proposal.id]: event.target.value }))
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => request(proposal.id)}
              >
                {isPending && busyId === proposal.id ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SendIcon data-icon="inline-start" />
                )}
                Pedir aprovação
              </Button>
            </div>
          )}

          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            render={<Link href="/propostas" />}
            nativeButton={false}
          >
            Abrir em Propostas
          </Button>
        </li>
      ))}
    </ul>
  )
}
