"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  BadgeCheckIcon,
  BadgePercentIcon,
  BookmarkCheckIcon,
  DownloadIcon,
  EyeIcon,
  HourglassIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  XCircleIcon,
} from "lucide-react"

import { formatPercent } from "@workspace/core/comissoes"
import type { FormDraftScope } from "@workspace/core/forms/draft"
import { formatRoundTitle } from "@workspace/core/proposals/rounds"
import { LISTING_PURPOSE_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/toast"
import { cn } from "@workspace/ui/lib/utils"

import { MobileCard, MobileCardList } from "@/components/mobile-cards/mobile-card"
import {
  DiscountApprovalDialog,
  type DiscountApprovalTarget,
} from "@/components/propostas/discount-approval-dialog"
import type { ComboboxOption } from "@/components/propostas/option-combobox"
import {
  ProposalFormDialog,
  type EditableProposal,
  type ProposalPropertyOption,
} from "@/components/propostas/proposal-form-dialog"
import {
  ShareProposalDialog,
  type ProposalShareTarget,
} from "@/components/propostas/share-proposal-dialog"
import { formatDateOnly } from "@/lib/chaves/datetime"
import { formatCurrency, formatDateTime } from "@/lib/format"
import { changeProposalStatus, reserveProperty } from "@/lib/propostas/actions"
import type { ProposalDiscount } from "@/lib/propostas/discount"
import { amountToBrlInput } from "@/lib/propostas/money"
import type { ProposalRow } from "@/lib/propostas/queries"
import {
  getAllowedTransitions,
  getTransitionCopy,
  isOpenProposal,
  PROPOSAL_STATUS_BADGE,
  PROPOSAL_STATUS_LABELS,
  type ProposalStatus,
} from "@/lib/propostas/status"

export type ProposalTableRow = ProposalRow & {
  canUpdate: boolean
  isExpired: boolean
  /** Link público pronto (null quando não existe, foi revogado ou venceu). */
  shareUrl: string | null
  /** Desconto acima do limite da imobiliária (null quando a proposta não trava). */
  discount: ProposalDiscount | null
}

type ReserveOffer = { propertyId: string; propertyLabel: string }

function propertyLabel(row: ProposalTableRow) {
  return row.property ? `${row.property.code} · ${row.property.title}` : "Imóvel"
}

function toEditable(row: ProposalTableRow): EditableProposal {
  const open = isOpenProposal(row.status)

  return {
    id: row.id,
    readOnly: !open || !row.canUpdate,
    readOnlyReason: !open
      ? `Proposta ${PROPOSAL_STATUS_LABELS[row.status].toLowerCase()}: não pode mais ser editada.`
      : !row.canUpdate
        ? "Só o corretor da proposta ou quem edita o imóvel pode alterar esta proposta."
        : null,
    propertyLabel: propertyLabel(row),
    clientLabel: row.client?.name ?? "Cliente sem acesso",
    brokerLabel: row.brokerLabel,
    values: {
      propertyId: row.propertyId,
      clientId: row.clientId,
      brokerId: row.brokerId ?? "",
      purpose: row.purpose,
      amount: amountToBrlInput(row.amount),
      paymentTerms: row.paymentTerms ?? "",
      conditions: row.conditions ?? "",
      validUntil: row.validUntil ?? "",
    },
  }
}

type ProposalsTableProps = {
  rows: ProposalTableRow[]
  properties: ProposalPropertyOption[]
  clients: ComboboxOption[]
  brokers: ComboboxOption[]
  organizationName: string
  /** Dono ou gerente: responde pedidos de desconto em Comissões. */
  canReviewDiscounts: boolean
  /** Usuário + imobiliária do rascunho local (evita perguntar ao servidor ao abrir). */
  draftScope?: FormDraftScope
}

/** Dados do diálogo de envio: link, validade e registro de leitura da proposta. */
function toShareTarget(row: ProposalTableRow, organizationName: string): ProposalShareTarget {
  return {
    proposalId: row.id,
    title: proposalTitle(row),
    organizationName,
    purposeLabel: LISTING_PURPOSE_LABELS[row.purpose],
    amountLabel: formatCurrency(row.amount),
    url: row.shareUrl,
    expiresAt: row.share?.expiresAt ?? null,
    firstViewedAt: row.share?.firstViewedAt ?? null,
    lastViewedAt: row.share?.lastViewedAt ?? null,
    viewCount: row.share?.viewCount ?? 0,
    canShare: row.canUpdate,
    pdfUrl: `/api/propostas/${row.id}/pdf`,
  }
}

function proposalTitle(row: ProposalTableRow) {
  return `${propertyLabel(row)} · ${row.client?.name ?? "cliente"}`
}

/** Selo do desconto na coluna Status: abre o pedido de aprovação. */
function discountBadge(discount: ProposalDiscount) {
  if (discount.approved) {
    return { icon: BadgeCheckIcon, label: "Desconto aprovado", variant: "outline" as const }
  }

  switch (discount.latestRequest?.status) {
    case "pending":
      return { icon: HourglassIcon, label: "Desconto com o gerente", variant: "secondary" as const }
    case "rejected":
      return { icon: XCircleIcon, label: "Desconto recusado", variant: "destructive" as const }
    default:
      return {
        icon: BadgePercentIcon,
        label: `Desconto de ${formatPercent(discount.percent)}: pedir aprovação`,
        variant: "destructive" as const,
      }
  }
}

function ProposalDiscountBadge({
  discount,
  onOpen,
}: {
  discount: ProposalDiscount
  onOpen: () => void
}) {
  const badge = discountBadge(discount)
  const Icon = badge.icon

  return (
    <Badge
      variant={badge.variant}
      className="cursor-pointer"
      render={<button type="button" onClick={onOpen} />}
    >
      <Icon data-icon="inline-start" />
      {badge.label}
    </Badge>
  )
}

/** Aviso do diálogo de enviar/aceitar quando a lista já sabe que o desconto trava. */
function discountTransitionNotice(discount: ProposalDiscount, to: ProposalStatus) {
  const action = to === "accepted" ? "aceita" : "enviada"

  if (discount.latestRequest?.status === "pending") {
    return `O desconto de ${formatPercent(discount.percent)} está esperando o gerente. Sem a aprovação, a proposta não pode ser ${action}.`
  }

  return `O desconto de ${formatPercent(discount.percent)} passa do limite de ${formatPercent(discount.limitPercent)}. Sem a aprovação do gerente, a proposta não pode ser ${action}.`
}

/** Coluna "Envio": o que o corretor precisa saber sem abrir o diálogo. */
function ProposalDeliveryCell({ row }: { row: ProposalTableRow }) {
  if (row.share?.firstViewedAt) {
    return (
      <span className="flex items-center gap-1.5 text-sm">
        <EyeIcon className="size-3.5 text-muted-foreground" />
        <span>Aberta em {formatDateTime(row.share.firstViewedAt)}</span>
      </span>
    )
  }

  if (row.shareUrl) {
    return <Badge variant="secondary">Link enviado</Badge>
  }

  return <span className="text-muted-foreground">—</span>
}

/**
 * Rodada vigente da negociação, discreta ao lado do valor. Só aparece depois
 * da proposta inicial (rodada 1 é o caso comum e não precisa de aviso).
 */
function ProposalRoundNote({ row }: { row: ProposalTableRow }) {
  if (row.roundNumber <= 1) return null

  return (
    <span
      className="text-xs text-muted-foreground"
      title={formatRoundTitle(row.roundNumber, row.roundKind)}
    >
      Rodada {row.roundNumber}
    </span>
  )
}

function ProposalValidity({ row }: { row: ProposalTableRow }) {
  if (!row.validUntil) {
    return <span className="text-muted-foreground">Sem validade</span>
  }

  return (
    <span className={cn(row.isExpired && "font-medium text-destructive")}>
      {row.isExpired ? "Venceu em " : ""}
      {formatDateOnly(row.validUntil)}
    </span>
  )
}

function ProposalStatusBadges({
  row,
  onOpenDiscount,
}: {
  row: ProposalTableRow
  onOpenDiscount: () => void
}) {
  return (
    <>
      <Badge variant={PROPOSAL_STATUS_BADGE[row.status]}>
        {PROPOSAL_STATUS_LABELS[row.status]}
      </Badge>
      {row.isExpired ? <Badge variant="destructive">Vencida</Badge> : null}
      {row.discount ? (
        <ProposalDiscountBadge discount={row.discount} onOpen={onOpenDiscount} />
      ) : null}
    </>
  )
}

type ProposalRowActions = {
  onEdit: (row: ProposalTableRow) => void
  onShare: (row: ProposalTableRow) => void
  onDiscount: (row: ProposalTableRow) => void
  onTransition: (row: ProposalTableRow, to: ProposalStatus) => void
}

function ProposalActionsMenu({
  row,
  onEdit,
  onShare,
  onDiscount,
  onTransition,
}: ProposalRowActions & { row: ProposalTableRow }) {
  const transitions = getAllowedTransitions(row.status)
  const canEditFields = isOpenProposal(row.status) && row.canUpdate

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <MoreHorizontalIcon />
        <span className="sr-only">Ações da proposta</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onEdit(row)}>
            {canEditFields ? <PencilIcon /> : <EyeIcon />}
            {canEditFields ? "Editar proposta" : "Ver detalhes"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onShare(row)}>
            <Share2Icon />
            {row.shareUrl ? "Ver link da proposta" : "Enviar ao cliente"}
          </DropdownMenuItem>
          {row.discount && !row.discount.approved ? (
            <DropdownMenuItem onClick={() => onDiscount(row)}>
              <BadgePercentIcon />
              {row.discount.latestRequest?.status === "pending"
                ? "Ver pedido de desconto"
                : "Pedir aprovação do desconto"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem render={<a href={`/api/propostas/${row.id}/pdf`} />}>
            <DownloadIcon />
            Baixar PDF
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {transitions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {transitions.map((to) => {
                const transitionCopy = getTransitionCopy(row.status, to)

                return (
                  <DropdownMenuItem
                    key={to}
                    variant={transitionCopy.destructive ? "destructive" : "default"}
                    disabled={!row.canUpdate}
                    onClick={() => onTransition(row, to)}
                  >
                    {transitionCopy.action}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Cartão do celular: status, valor e validade em destaque, com enviar ao
 * cliente e abrir a proposta a um toque; o resto fica no menu.
 */
function ProposalMobileCard({ row, ...actions }: ProposalRowActions & { row: ProposalTableRow }) {
  const canEditFields = isOpenProposal(row.status) && row.canUpdate

  return (
    <MobileCard
      highlight={row.isExpired}
      title={
        <span className="line-clamp-2">
          {row.property ? `${row.property.code} · ${row.property.title}` : "Imóvel"}
        </span>
      }
      description={`${row.client?.name ?? "Cliente sem acesso"} · ${LISTING_PURPOSE_LABELS[row.purpose]}`}
      menu={<ProposalActionsMenu row={row} {...actions} />}
      badges={<ProposalStatusBadges row={row} onOpenDiscount={() => actions.onDiscount(row)} />}
      facts={[
        {
          label: "Valor",
          value: (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium tabular-nums">{formatCurrency(row.amount)}</span>
              <ProposalRoundNote row={row} />
            </span>
          ),
        },
        { label: "Validade", value: <ProposalValidity row={row} /> },
        { label: "Envio", value: <ProposalDeliveryCell row={row} /> },
      ]}
      actions={
        <>
          <Button variant="outline" onClick={() => actions.onShare(row)}>
            <Share2Icon data-icon="inline-start" />
            {row.shareUrl ? "Ver link" : "Enviar ao cliente"}
          </Button>
          <Button variant="outline" onClick={() => actions.onEdit(row)}>
            {canEditFields ? (
              <PencilIcon data-icon="inline-start" />
            ) : (
              <EyeIcon data-icon="inline-start" />
            )}
            {canEditFields ? "Editar" : "Ver detalhes"}
          </Button>
        </>
      }
    />
  )
}

export function ProposalsTable({
  rows,
  properties,
  clients,
  brokers,
  organizationName,
  canReviewDiscounts,
  draftScope,
}: ProposalsTableProps) {
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<EditableProposal | null>(null)
  const [transition, setTransition] = React.useState<{
    row: ProposalTableRow
    to: ProposalStatus
  } | null>(null)
  const [transitionOpen, setTransitionOpen] = React.useState(false)
  // Recusa do gatilho de desconto na última tentativa de enviar/aceitar.
  const [transitionError, setTransitionError] = React.useState<string | null>(null)
  // Título e permissão guardados no clique: se a linha sair da lista (filtro de
  // status depois da contraproposta), o diálogo continua com o que mostrar.
  const [discountRequest, setDiscountRequest] = React.useState<{
    rowId: string
    title: string
    canRequest: boolean
    blockedMessage: string | null
  } | null>(null)
  const [discountOpen, setDiscountOpen] = React.useState(false)
  const [shareRowId, setShareRowId] = React.useState<string | null>(null)
  const [shareOpen, setShareOpen] = React.useState(false)
  const [reserveOffer, setReserveOffer] = React.useState<ReserveOffer | null>(null)
  const [reserveOpen, setReserveOpen] = React.useState(false)
  const [isChanging, startChange] = React.useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isReserving, startReserve] = React.useTransition()

  function openForm(row: ProposalTableRow) {
    setEditing(toEditable(row))
    setFormOpen(true)
  }

  // Derivado das linhas (e não copiado no clique): depois de gerar o link ou de
  // o cliente abrir a proposta, o diálogo já mostra o estado novo.
  const shareRow = rows.find((row) => row.id === shareRowId) ?? null
  const shareTarget = shareRow ? toShareTarget(shareRow, organizationName) : null

  function openShare(row: ProposalTableRow) {
    setShareRowId(row.id)
    setShareOpen(true)
  }

  // Derivado das linhas, como o do link: depois do pedido o diálogo e o selo já
  // mostram a situação nova.
  const discountRow = discountRequest
    ? (rows.find((row) => row.id === discountRequest.rowId) ?? null)
    : null
  const discountTarget: DiscountApprovalTarget | null = discountRequest
    ? {
        proposalId: discountRequest.rowId,
        title: discountRow ? proposalTitle(discountRow) : discountRequest.title,
        // Fora da lista, a medida antiga não vale mais: o diálogo pede sem números.
        discount: discountRow?.discount ?? null,
        blockedMessage: discountRequest.blockedMessage,
        canRequest: discountRow?.canUpdate ?? discountRequest.canRequest,
        canReview: canReviewDiscounts,
      }
    : null

  function openDiscount(
    target: { rowId: string; title: string; canRequest: boolean },
    blockedMessage: string | null = null
  ) {
    setDiscountRequest({ ...target, blockedMessage })
    setDiscountOpen(true)
  }

  function openDiscountForRow(row: ProposalTableRow, blockedMessage: string | null = null) {
    openDiscount(
      { rowId: row.id, title: proposalTitle(row), canRequest: row.canUpdate },
      blockedMessage
    )
  }

  // Depois de "Registrar contraproposta e salvar": a proposta virou contraproposta
  // e sairia de um filtro de outro status. A lista passa para a aba certa.
  function openDiscountAfterCounterOffer(proposalId: string) {
    const status = searchParams.get("status")

    if (status && status !== "countered") {
      const params = new URLSearchParams(searchParams.toString())

      params.set("status", "countered")
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }

    openDiscount({
      rowId: proposalId,
      title: editing ? `${editing.propertyLabel} · ${editing.clientLabel}` : "Proposta",
      canRequest: !(editing?.readOnly ?? false),
    })
  }

  function openTransition(row: ProposalTableRow, to: ProposalStatus) {
    setTransition({ row, to })
    setTransitionError(null)
    setTransitionOpen(true)
  }

  const copy = transition ? getTransitionCopy(transition.row.status, transition.to) : null
  const transitionDiscount =
    transition &&
    (transition.to === "sent" || transition.to === "accepted") &&
    transition.row.discount &&
    !transition.row.discount.approved
      ? transition.row.discount
      : null
  const showDiscountAction = Boolean(transitionError || transitionDiscount)

  function requestFromTransition() {
    if (!transition) return

    setTransitionOpen(false)
    openDiscountForRow(transition.row, transitionError)
  }

  function runTransition() {
    if (!transition) return

    const { row, to } = transition

    startChange(async () => {
      const result = await changeProposalStatus(row.id, to)

      if (!result.ok) {
        if (result.needsDiscountApproval) {
          // O banco barrou pelo desconto: o diálogo troca o "confirmar" pelo pedido.
          setTransitionError(result.error)
          // A lista pode estar velha (valor ou pedido mudou): o diálogo de pedido
          // já abre com os dados do banco.
          router.refresh()
          return
        }

        toast.add({
          title: "Não foi possível alterar",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message, type: "success" })
      setTransitionOpen(false)

      if (result.reserveOffer) {
        setReserveOffer(result.reserveOffer)
        setReserveOpen(true)
      }
    })
  }

  function runReserve() {
    if (!reserveOffer) return

    const { propertyId } = reserveOffer

    startReserve(async () => {
      const result = await reserveProperty(propertyId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível reservar",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Imóvel reservado.",
        type: "success",
      })
      setReserveOpen(false)
    })
  }

  const rowActions: ProposalRowActions = {
    onEdit: openForm,
    onShare: openShare,
    onDiscount: (row) => openDiscountForRow(row),
    onTransition: openTransition,
  }

  return (
    <>
      <div className="max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Corretor</TableHead>
              <TableHead>Finalidade</TableHead>
              <TableHead className="text-end">Valor</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Envio</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(row.isExpired && "bg-destructive/5")}>
                <TableCell>
                  {row.property ? (
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/propostas?imovel=${row.property.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.property.code}
                      </Link>
                      <span className="max-w-56 truncate text-muted-foreground">
                        {row.property.title}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-48 truncate">
                  {row.client?.name ?? (
                    <span className="text-muted-foreground">Cliente sem acesso</span>
                  )}
                </TableCell>
                <TableCell className="max-w-40 truncate">
                  {row.brokerLabel ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{LISTING_PURPOSE_LABELS[row.purpose]}</TableCell>
                <TableCell className="text-end tabular-nums">
                  <div className="flex flex-col items-end">
                    <span className="font-medium">{formatCurrency(row.amount)}</span>
                    <ProposalRoundNote row={row} />
                  </div>
                </TableCell>
                <TableCell>
                  <ProposalValidity row={row} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <ProposalStatusBadges
                      row={row}
                      onOpenDiscount={() => openDiscountForRow(row)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <ProposalDeliveryCell row={row} />
                </TableCell>
                <TableCell className="text-end">
                  <ProposalActionsMenu row={row} {...rowActions} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MobileCardList aria-label="Propostas">
        {rows.map((row) => (
          <ProposalMobileCard key={row.id} row={row} {...rowActions} />
        ))}
      </MobileCardList>

      <ShareProposalDialog target={shareTarget} open={shareOpen} onOpenChange={setShareOpen} />

      <DiscountApprovalDialog
        target={discountTarget}
        open={discountOpen}
        onOpenChange={setDiscountOpen}
      />

      <ProposalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        properties={properties}
        clients={clients}
        brokers={brokers}
        editing={editing}
        onDiscountApprovalNeeded={openDiscountAfterCounterOffer}
        draftScope={draftScope}
      />

      <AlertDialog open={transitionOpen} onOpenChange={setTransitionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {transition
                ? `${propertyLabel(transition.row)} · ${formatCurrency(transition.row.amount)}. `
                : ""}
              {copy?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {transitionError ? (
            <Alert variant="destructive">
              <BadgePercentIcon />
              <AlertTitle>Precisa da aprovação do gerente</AlertTitle>
              <AlertDescription>{transitionError}</AlertDescription>
            </Alert>
          ) : transition && transitionDiscount ? (
            <Alert>
              <BadgePercentIcon />
              <AlertTitle>Desconto acima do limite</AlertTitle>
              <AlertDescription>
                {discountTransitionNotice(transitionDiscount, transition.to)}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChanging}>Cancelar</AlertDialogCancel>
            {/* Depois da recusa do banco, confirmar de novo não adianta. Só com o
                aviso da lista, a tentativa continua: o pedido aprovado pode ser
                de outra pessoa, que o RLS não mostra. */}
            {transitionError ? null : (
              <AlertDialogAction
                variant={
                  showDiscountAction ? "outline" : copy?.destructive ? "destructive" : "default"
                }
                disabled={isChanging}
                onClick={runTransition}
              >
                {isChanging ? <Spinner data-icon="inline-start" /> : null}
                {copy?.confirm}
              </AlertDialogAction>
            )}
            {showDiscountAction ? (
              <Button disabled={isChanging} onClick={requestFromTransition}>
                <BadgePercentIcon data-icon="inline-start" />
                {!transitionError && transitionDiscount?.latestRequest?.status === "pending"
                  ? "Ver pedido de aprovação"
                  : "Pedir aprovação do gerente"}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reserveOpen} onOpenChange={setReserveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <BookmarkCheckIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Marcar o imóvel como reservado?</AlertDialogTitle>
            <AlertDialogDescription>
              {reserveOffer?.propertyLabel}. Com a proposta aceita, o imóvel pode sair da lista de
              disponíveis enquanto a negociação é concluída.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReserving}>Agora não</AlertDialogCancel>
            <AlertDialogAction disabled={isReserving} onClick={runReserve}>
              {isReserving ? <Spinner data-icon="inline-start" /> : null}
              Marcar como reservado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
