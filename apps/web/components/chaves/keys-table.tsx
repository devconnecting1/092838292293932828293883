"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { KEY_STATUS_LABELS } from "@workspace/core/properties/enums"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
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

import { KeyCheckoutDialog } from "@/components/chaves/key-checkout-dialog"
import { KeyFormDialog } from "@/components/chaves/key-form-dialog"
import { KeyHistorySheet } from "@/components/chaves/key-history-sheet"
import {
  MobileCard,
  MobileCardList,
  type MobileCardFact,
} from "@/components/mobile-cards/mobile-card"
import type { ComboboxOption } from "@/components/propostas/option-combobox"
import { markKeyFound, markKeyLost, returnKey } from "@/lib/chaves/actions"
import type { KeyRow } from "@/lib/chaves/queries"
import { formatDateTime } from "@/lib/format"

export type KeyTableRow = KeyRow & {
  canEdit: boolean
  canCheckout: boolean
  canReturn: boolean
}

type DialogKind = "edit" | "checkout" | "history" | "return" | "lost" | "found"

const CONFIRM_COPY = {
  return: {
    title: "Registrar devolução?",
    description: "A chave volta a ficar disponível.",
    confirm: "Registrar devolução",
    run: returnKey,
  },
  lost: {
    title: "Marcar a chave como perdida?",
    description:
      "Ela deixa de poder ser retirada até ser marcada como encontrada. Use quando a chave sumir.",
    confirm: "Marcar como perdida",
    run: markKeyLost,
  },
  found: {
    title: "Marcar a chave como encontrada?",
    description: "A chave volta ao status de antes (disponível ou retirada).",
    confirm: "Marcar como encontrada",
    run: markKeyFound,
  },
} as const

function keyTitle(row: KeyTableRow) {
  return row.property ? `${row.label} · ${row.property.code} ${row.property.title}` : row.label
}

function KeyStatusBadge({ row }: { row: KeyTableRow }) {
  if (row.openMovement?.isOverdue) {
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon data-icon="inline-start" />
        Devolução vencida
      </Badge>
    )
  }

  const variant =
    row.status === "available" ? "secondary" : row.status === "checked_out" ? "default" : "outline"

  return <Badge variant={variant}>{KEY_STATUS_LABELS[row.status]}</Badge>
}

/** Quem está com a chave e até quando (coluna "Com quem" e cartão do celular). */
function KeyTaker({ row }: { row: KeyTableRow }) {
  const movement = row.openMovement

  if (!movement) {
    return <span className="text-muted-foreground">—</span>
  }

  const isOverdue = movement.isOverdue

  return (
    <div className="flex min-w-0 flex-col">
      <span className={cn("truncate", isOverdue && "font-medium text-destructive")}>
        {movement.takerLabel}
        {movement.takerKind === "client" ? " (cliente)" : ""}
      </span>
      <span className={cn("text-xs text-muted-foreground", isOverdue && "text-destructive")}>
        {movement.dueAt
          ? `${isOverdue ? "Deveria voltar em" : "Devolver até"} ${formatDateTime(movement.dueAt)}`
          : `Retirada em ${formatDateTime(movement.takenAt)}`}
      </span>
    </div>
  )
}

function KeyActionsMenu({
  row,
  onOpen,
}: {
  row: KeyTableRow
  onOpen: (kind: DialogKind, row: KeyTableRow) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <MoreHorizontalIcon />
        <span className="sr-only">Ações da chave {row.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {row.status === "available" ? (
            <DropdownMenuItem disabled={!row.canCheckout} onClick={() => onOpen("checkout", row)}>
              <ArrowUpFromLineIcon />
              Registrar retirada
            </DropdownMenuItem>
          ) : null}
          {row.status === "checked_out" ? (
            <DropdownMenuItem disabled={!row.canReturn} onClick={() => onOpen("return", row)}>
              <ArrowDownToLineIcon />
              Registrar devolução
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => onOpen("history", row)}>
            <HistoryIcon />
            Histórico
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!row.canEdit} onClick={() => onOpen("edit", row)}>
            <PencilIcon />
            Editar local e rótulo
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {row.status === "lost" ? (
            <DropdownMenuItem disabled={!row.canEdit} onClick={() => onOpen("found", row)}>
              <SearchCheckIcon />
              Marcar como encontrada
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              disabled={!row.canEdit}
              onClick={() => onOpen("lost", row)}
            >
              <TriangleAlertIcon />
              Marcar como perdida
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Cartão do celular: status e prazo em destaque, com retirada ou devolução e
 * histórico a um toque (retirada em até 3 toques: botão, quem retira, confirmar).
 */
function KeyMobileCard({
  row,
  onOpen,
}: {
  row: KeyTableRow
  onOpen: (kind: DialogKind, row: KeyTableRow) => void
}) {
  const facts: MobileCardFact[] = [
    {
      label: "Local",
      value: row.location ?? <span className="text-muted-foreground">Não informado</span>,
    },
  ]

  if (row.openMovement) {
    facts.push({ label: "Com quem", value: <KeyTaker row={row} /> })
  }

  if (row.notes) {
    facts.push({ label: "Observação", value: row.notes })
  }

  return (
    <MobileCard
      highlight={Boolean(row.openMovement?.isOverdue)}
      title={row.label}
      description={
        row.property ? (
          <span className="block truncate">
            <span className="font-mono text-xs">{row.property.code}</span> {row.property.title}
          </span>
        ) : null
      }
      menu={<KeyActionsMenu row={row} onOpen={onOpen} />}
      badges={<KeyStatusBadge row={row} />}
      facts={facts}
      actions={
        <>
          {row.status === "available" && row.canCheckout ? (
            <Button onClick={() => onOpen("checkout", row)}>
              <ArrowUpFromLineIcon data-icon="inline-start" />
              Registrar retirada
            </Button>
          ) : null}
          {row.status === "checked_out" && row.canReturn ? (
            <Button onClick={() => onOpen("return", row)}>
              <ArrowDownToLineIcon data-icon="inline-start" />
              Registrar devolução
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpen("history", row)}>
            <HistoryIcon data-icon="inline-start" />
            Histórico
          </Button>
        </>
      }
    />
  )
}

type KeysTableProps = {
  rows: KeyTableRow[]
  members: ComboboxOption[]
  clients: ComboboxOption[]
  editableProperties: ComboboxOption[]
  currentUserId: string
}

export function KeysTable({
  rows,
  members,
  clients,
  editableProperties,
  currentUserId,
}: KeysTableProps) {
  const [dialog, setDialog] = React.useState<DialogKind | null>(null)
  const [activeRow, setActiveRow] = React.useState<KeyTableRow | null>(null)
  const [isConfirming, startConfirm] = React.useTransition()

  function openDialog(kind: DialogKind, row: KeyTableRow) {
    setActiveRow(row)
    setDialog(kind)
  }

  function closeDialog(open: boolean) {
    if (!open) setDialog(null)
  }

  const confirmKind = dialog === "return" || dialog === "lost" || dialog === "found" ? dialog : null
  const confirmCopy = confirmKind ? CONFIRM_COPY[confirmKind] : null

  function runConfirm() {
    if (!activeRow || !confirmCopy) return

    const { run } = confirmCopy
    const keyId = activeRow.id

    startConfirm(async () => {
      const result = await run(keyId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível concluir",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Pronto.", type: "success" })
      setDialog(null)
    })
  }

  return (
    <>
      <div className="max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Com quem</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(row.openMovement?.isOverdue && "bg-destructive/5")}
              >
                <TableCell>
                  {row.property ? (
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/chaves?imovel=${row.property.id}`}
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
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{row.label}</span>
                    {row.notes ? (
                      <span className="max-w-56 truncate text-xs text-muted-foreground">
                        {row.notes}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="max-w-48 truncate">
                  {row.location ?? <span className="text-muted-foreground">Não informado</span>}
                </TableCell>
                <TableCell>
                  <KeyStatusBadge row={row} />
                </TableCell>
                <TableCell>
                  <KeyTaker row={row} />
                </TableCell>
                <TableCell className="text-end">
                  <KeyActionsMenu row={row} onOpen={openDialog} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MobileCardList aria-label="Chaves">
        {rows.map((row) => (
          <KeyMobileCard key={row.id} row={row} onOpen={openDialog} />
        ))}
      </MobileCardList>

      <KeyFormDialog
        open={dialog === "edit"}
        onOpenChange={closeDialog}
        properties={editableProperties}
        editingKey={
          activeRow?.property
            ? {
                id: activeRow.id,
                propertyId: activeRow.property.id,
                propertyLabel: `${activeRow.property.code} · ${activeRow.property.title}`,
                label: activeRow.label,
                location: activeRow.location,
                notes: activeRow.notes,
              }
            : null
        }
      />

      <KeyCheckoutDialog
        open={dialog === "checkout"}
        onOpenChange={closeDialog}
        keyId={activeRow?.id ?? null}
        keyTitle={activeRow ? keyTitle(activeRow) : ""}
        members={members}
        clients={clients}
        currentUserId={currentUserId}
      />

      <KeyHistorySheet
        open={dialog === "history"}
        onOpenChange={closeDialog}
        keyId={activeRow?.id ?? null}
        keyTitle={activeRow ? keyTitle(activeRow) : ""}
      />

      <AlertDialog open={confirmKind !== null} onOpenChange={closeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {activeRow ? `${keyTitle(activeRow)}. ` : ""}
              {confirmCopy?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirming}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmKind === "lost" ? "destructive" : "default"}
              disabled={isConfirming}
              onClick={runConfirm}
            >
              {isConfirming ? <Spinner data-icon="inline-start" /> : null}
              {confirmCopy?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
