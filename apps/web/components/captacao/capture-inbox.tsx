"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArchiveXIcon,
  HousePlusIcon,
  MailIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PhoneCallIcon,
  PhoneIcon,
  RotateCcwIcon,
} from "lucide-react"

import {
  CAPTURE_STATUS_LABELS,
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@workspace/core/properties/enums"
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { updateCaptureStatus, type ManualCaptureStatus } from "@/lib/captacao/actions"
import { formatPhoneDisplay, telUrl, whatsappUrl } from "@/lib/captacao/masks"
import type { CaptureRow, CaptureStatus } from "@/lib/captacao/queries"
import { formatCurrency, formatDateTime } from "@/lib/format"

const STATUS_BADGE: Record<CaptureStatus, "default" | "secondary" | "outline"> = {
  new: "default",
  contacted: "secondary",
  converted: "secondary",
  discarded: "outline",
}

function formatLocation(row: CaptureRow) {
  const cityState = [row.city, row.state].filter(Boolean).join("/")
  const parts = [row.neighborhood, cityState].filter(Boolean)
  const postal = row.postalCode
    ? `CEP ${row.postalCode.slice(0, 5)}-${row.postalCode.slice(5)}`
    : null

  return [...parts, postal].filter(Boolean).join(" · ") || null
}

function CaptureCard({
  row,
  pendingId,
  onChangeStatus,
  onDiscard,
}: {
  row: CaptureRow
  pendingId: string | null
  onChangeStatus: (row: CaptureRow, status: ManualCaptureStatus) => void
  onDiscard: (row: CaptureRow) => void
}) {
  const whatsapp = whatsappUrl(row.ownerPhone)
  const tel = telUrl(row.ownerPhone)
  const location = formatLocation(row)
  const isPending = pendingId === row.id
  const isConverted = row.status === "converted"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{row.ownerName}</CardTitle>
        <CardDescription>Recebida em {formatDateTime(row.createdAt)}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Badge variant={STATUS_BADGE[row.status]}>{CAPTURE_STATUS_LABELS[row.status]}</Badge>
          {isConverted ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" disabled={isPending} />}
              >
                {isPending ? <Spinner /> : <MoreHorizontalIcon />}
                <span className="sr-only">Mudar status da captação</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  {row.status !== "contacted" ? (
                    <DropdownMenuItem onClick={() => onChangeStatus(row, "contacted")}>
                      <PhoneCallIcon />
                      Marcar como contatada
                    </DropdownMenuItem>
                  ) : null}
                  {row.status !== "new" ? (
                    <DropdownMenuItem onClick={() => onChangeStatus(row, "new")}>
                      <RotateCcwIcon />
                      Voltar para nova
                    </DropdownMenuItem>
                  ) : null}
                  {row.status !== "discarded" ? (
                    <DropdownMenuItem variant="destructive" onClick={() => onDiscard(row)}>
                      <ArchiveXIcon />
                      Descartar
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Imóvel</dt>
          <dd>
            {LISTING_PURPOSE_LABELS[row.purpose]}
            {row.type ? ` · ${PROPERTY_TYPE_LABELS[row.type]}` : ""}
          </dd>
          <dt className="text-muted-foreground">Local</dt>
          <dd>{location ?? <span className="text-muted-foreground">Não informado</span>}</dd>
          <dt className="text-muted-foreground">Valor esperado</dt>
          <dd className="tabular-nums">
            {row.expectedPrice ? (
              formatCurrency(row.expectedPrice)
            ) : (
              <span className="text-muted-foreground">Não informado</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Contato</dt>
          <dd className="flex min-w-0 flex-col">
            {row.ownerPhone ? <span>{formatPhoneDisplay(row.ownerPhone)}</span> : null}
            {row.ownerEmail ? <span className="truncate">{row.ownerEmail}</span> : null}
          </dd>
          {row.convertedProperty ? (
            <>
              <dt className="text-muted-foreground">Imóvel criado</dt>
              <dd>
                {row.convertedProperty.code} · {row.convertedProperty.title}
              </dd>
            </>
          ) : null}
        </dl>
        {row.message ? (
          <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">{row.message}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Consentimento LGPD registrado em {formatDateTime(row.consentAt)}.
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {whatsapp ? (
          <Button
            variant="outline"
            size="sm"
            render={<a href={whatsapp} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
          >
            <MessageCircleIcon data-icon="inline-start" />
            WhatsApp
          </Button>
        ) : null}
        {tel ? (
          <Button variant="outline" size="sm" render={<a href={tel} />} nativeButton={false}>
            <PhoneIcon data-icon="inline-start" />
            Ligar
          </Button>
        ) : null}
        {row.ownerEmail ? (
          <Button
            variant="outline"
            size="sm"
            render={<a href={`mailto:${encodeURIComponent(row.ownerEmail)}`} />}
            nativeButton={false}
          >
            <MailIcon data-icon="inline-start" />
            E-mail
          </Button>
        ) : null}
        {isConverted || row.status === "discarded" ? null : (
          <Button
            size="sm"
            className="sm:ms-auto"
            render={<Link href={`/imoveis/novo?captacao=${row.id}`} />}
            nativeButton={false}
          >
            <HousePlusIcon data-icon="inline-start" />
            Converter em imóvel
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

export function CaptureInbox({ rows }: { rows: CaptureRow[] }) {
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [discardRow, setDiscardRow] = React.useState<CaptureRow | null>(null)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const [isDiscarding, startDiscard] = React.useTransition()
  const [, startChange] = React.useTransition()

  function changeStatus(row: CaptureRow, status: ManualCaptureStatus) {
    setPendingId(row.id)

    startChange(async () => {
      const result = await updateCaptureStatus(row.id, status)
      setPendingId(null)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível atualizar",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Captação atualizada.",
        type: "success",
      })
    })
  }

  function confirmDiscard() {
    if (!discardRow) return

    const captureId = discardRow.id

    startDiscard(async () => {
      const result = await updateCaptureStatus(captureId, "discarded")

      if (!result.ok) {
        toast.add({
          title: "Não foi possível descartar",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Captação descartada.",
        type: "success",
      })
      setDiscardOpen(false)
    })
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map((row) => (
          <CaptureCard
            key={row.id}
            row={row}
            pendingId={pendingId}
            onChangeStatus={changeStatus}
            onDiscard={(target) => {
              setDiscardRow(target)
              setDiscardOpen(true)
            }}
          />
        ))}
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar esta captação?</AlertDialogTitle>
            <AlertDialogDescription>
              {discardRow ? `${discardRow.ownerName}. ` : ""}
              Use quando o imóvel não interessar à imobiliária. Você pode reabrir a captação depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDiscarding}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDiscarding}
              onClick={confirmDiscard}
            >
              {isDiscarding ? <Spinner data-icon="inline-start" /> : null}
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
