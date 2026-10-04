"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  CopyIcon,
  CopyPlusIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
} from "lucide-react"

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import { useCopyToClipboard } from "@/components/configuracoes/copy-field"
import { LandingStatusBadge } from "@/components/marketing/landing-status-badge"
import { formatDate, formatNumber } from "@/lib/format"
import { duplicateLandingPageAction, setLandingStatusAction } from "@/lib/marketing/actions"
import {
  landingEditorPath,
  landingPreviewPath,
  type LandingStatus,
} from "@/lib/marketing/constants"
import { displayUrl } from "@/lib/marketing/urls"

export type LandingTableRow = {
  id: string
  name: string
  templateName: string
  status: LandingStatus
  /** Endereço no subdomínio da imobiliária; null se indisponível. */
  publicUrl: string | null
  leadCount: number | null
  publishedAt: string | null
}

type PendingConfirm = {
  row: LandingTableRow
  to: LandingStatus
}

const CONFIRM_COPY: Record<LandingStatus, { title: string; description: string; confirm: string }> =
  {
    published: {
      title: "Publicar a página de captação?",
      description: "A página fica acessível no endereço público e passa a receber leads no funil.",
      confirm: "Publicar",
    },
    draft: {
      title: "Despublicar a página de captação?",
      description:
        "O endereço público deixa de funcionar e a página volta a ser rascunho. Os leads já recebidos continuam no funil.",
      confirm: "Despublicar",
    },
    archived: {
      title: "Arquivar a página de captação?",
      description:
        "A página sai do ar e vai para a lista de arquivadas. Você pode restaurá-la como rascunho depois.",
      confirm: "Arquivar",
    },
  }

function CopyUrlButton({ url }: { url: string }) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => copy(url, "Endereço da página de captação copiado.")}
          />
        }
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span className="sr-only">Copiar endereço público</span>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copiado" : "Copiar endereço"}</TooltipContent>
    </Tooltip>
  )
}

export function LandingPagesTable({
  rows,
  canEdit,
}: {
  rows: LandingTableRow[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [isChanging, startChange] = React.useTransition()
  const [duplicatingId, setDuplicatingId] = React.useState<string | null>(null)

  function askStatus(row: LandingTableRow, to: LandingStatus) {
    setPending({ row, to })
    setConfirmOpen(true)
  }

  function runStatusChange() {
    if (!pending) return
    const { row, to } = pending

    startChange(async () => {
      const result = await setLandingStatusAction(row.id, to)

      if (!result.ok) {
        toast.add({
          type: "error",
          title: "Não foi possível alterar",
          description: result.error,
        })
        return
      }

      toast.add({ type: "success", title: result.message })
      setConfirmOpen(false)
    })
  }

  function duplicate(row: LandingTableRow) {
    setDuplicatingId(row.id)

    startChange(async () => {
      const result = await duplicateLandingPageAction(row.id)
      setDuplicatingId(null)

      if (!result.ok) {
        toast.add({
          type: "error",
          title: "Não foi possível duplicar",
          description: result.error,
        })
        return
      }

      toast.add({ type: "success", title: result.message ?? "Cópia criada." })
      router.push(landingEditorPath(result.id))
    })
  }

  const isRestore = pending?.row.status === "archived" && pending.to === "draft"
  const copy = pending ? CONFIRM_COPY[pending.to] : null

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Página</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Endereço público</TableHead>
            <TableHead className="text-end">Leads</TableHead>
            <TableHead>Publicada em</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={landingEditorPath(row.id)}
                    className="max-w-64 truncate font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="max-w-64 truncate text-muted-foreground">
                    {row.templateName}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <LandingStatusBadge status={row.status} />
              </TableCell>
              <TableCell>
                {row.publicUrl ? (
                  <div className="flex max-w-80 min-w-0 items-center gap-1">
                    <span className="truncate text-muted-foreground" title={row.publicUrl}>
                      {displayUrl(row.publicUrl)}
                    </span>
                    <CopyUrlButton url={row.publicUrl} />
                    {row.status === "published" ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        render={
                          <a href={row.publicUrl} target="_blank" rel="noopener noreferrer" />
                        }
                        nativeButton={false}
                      >
                        <ExternalLinkIcon />
                        <span className="sr-only">Abrir página publicada</span>
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Endereço indisponível</span>
                )}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {row.leadCount == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatNumber(row.leadCount)
                )}
              </TableCell>
              <TableCell>
                {row.publishedAt && row.status === "published" ? (
                  formatDate(row.publishedAt)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-end">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" disabled={duplicatingId === row.id} />
                    }
                  >
                    {duplicatingId === row.id ? <Spinner /> : <MoreHorizontalIcon />}
                    <span className="sr-only">Ações de {row.name}</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuItem render={<Link href={landingEditorPath(row.id)} />}>
                        {canEdit ? <PencilIcon /> : <EyeIcon />}
                        {canEdit ? "Editar" : "Ver configuração"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        render={
                          <a
                            href={landingPreviewPath(row.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <EyeIcon />
                        Pré-visualizar
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {canEdit ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => duplicate(row)}>
                            <CopyPlusIcon />
                            Duplicar
                          </DropdownMenuItem>
                          {row.status === "published" ? (
                            <DropdownMenuItem onClick={() => askStatus(row, "draft")}>
                              <EyeOffIcon />
                              Despublicar
                            </DropdownMenuItem>
                          ) : null}
                          {row.status === "draft" ? (
                            <DropdownMenuItem onClick={() => askStatus(row, "published")}>
                              <SendIcon />
                              Publicar
                            </DropdownMenuItem>
                          ) : null}
                          {row.status === "archived" ? (
                            <DropdownMenuItem onClick={() => askStatus(row, "draft")}>
                              <ArchiveRestoreIcon />
                              Restaurar como rascunho
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => askStatus(row, "archived")}
                            >
                              <ArchiveIcon />
                              Arquivar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRestore ? "Restaurar a página de captação?" : copy?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? `${pending.row.name}. ` : ""}
              {isRestore
                ? "A página volta para a lista como rascunho. Publique quando quiser colocá-la no ar."
                : copy?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChanging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.to === "archived" ? "destructive" : "default"}
              disabled={isChanging}
              onClick={runStatusChange}
            >
              {isChanging ? <Spinner data-icon="inline-start" /> : null}
              {isRestore ? "Restaurar" : copy?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
