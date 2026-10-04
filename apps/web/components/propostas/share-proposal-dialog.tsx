"use client"

import * as React from "react"
import {
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  MessageCircleIcon,
  RefreshCwIcon,
} from "lucide-react"

import {
  PROPOSAL_SHARE_DAY_OPTIONS,
  PROPOSAL_SHARE_DEFAULT_DAYS,
} from "@workspace/core/proposals/share"
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
import { Field, FieldDescription, FieldGroup, FieldTitle } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { CopyField, useCopyToClipboard } from "@/components/configuracoes/copy-field"
import { buildWhatsAppShareUrl } from "@/lib/configuracoes/invitations"
import { formatDateTime } from "@/lib/format"
import { createProposalShare, revokeProposalShare } from "@/lib/propostas/actions"

/** O que a tela de propostas sabe sobre o link de uma proposta. */
export type ProposalShareTarget = {
  proposalId: string
  /** "AP-0012 · Maria Silva", para o cabeçalho do diálogo. */
  title: string
  organizationName: string
  purposeLabel: string
  amountLabel: string
  /** Link pronto (null quando não existe, foi revogado ou venceu). */
  url: string | null
  expiresAt: string | null
  firstViewedAt: string | null
  lastViewedAt: string | null
  viewCount: number
  /** Só o corretor da proposta ou quem edita o imóvel gera e revoga o link. */
  canShare: boolean
  pdfUrl: string
}

function buildShareMessage(target: ProposalShareTarget, url: string) {
  return [
    `Olá! Segue a proposta de ${target.purposeLabel.toLowerCase()} de ${target.amountLabel} registrada pela ${target.organizationName}.`,
    url,
    "O link abre no celular e tem o PDF para baixar.",
  ].join("\n\n")
}

export function ShareProposalDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ProposalShareTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [days, setDays] = React.useState<number>(PROPOSAL_SHARE_DEFAULT_DAYS)
  const [isSaving, startSaving] = React.useTransition()
  const { copy } = useCopyToClipboard()
  // O link vem da lista (que a action revalida). Este estado só cobre o
  // intervalo entre a resposta da action e a chegada dos dados novos — e é
  // amarrado à proposta, para não vazar de uma linha para outra.
  const [pending, setPending] = React.useState<{
    proposalId: string
    url: string | null
    expiresAt: string | null
  } | null>(null)

  if (!target) {
    return null
  }

  const fresh = pending?.proposalId === target.proposalId ? pending : null
  const url = fresh ? fresh.url : target.url
  const expiresAt = fresh ? fresh.expiresAt : target.expiresAt
  const link = url && expiresAt ? { url, expiresAt } : null
  const message = link ? buildShareMessage(target, link.url) : null

  function runShare(rotate: boolean) {
    if (!target) return

    startSaving(async () => {
      const result = await createProposalShare(target.proposalId, days, rotate)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível gerar o link",
          description: result.error,
          type: "error",
        })
        return
      }

      setPending({
        proposalId: target.proposalId,
        url: result.url,
        expiresAt: result.expiresAt,
      })
      toast.add({ title: result.message, type: "success" })
    })
  }

  function runRevoke() {
    if (!target) return

    startSaving(async () => {
      const result = await revokeProposalShare(target.proposalId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível desativar",
          description: result.error,
          type: "error",
        })
        return
      }

      setPending({ proposalId: target.proposalId, url: null, expiresAt: null })
      toast.add({ title: result.message ?? "Link desativado.", type: "success" })
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar a proposta ao cliente</DialogTitle>
          <DialogDescription>
            {target.title}. O link abre a proposta com a marca da imobiliária, sem login e sem anexo
            no WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {target.firstViewedAt ? (
            <Alert>
              <EyeIcon />
              <AlertTitle>O cliente abriu a proposta</AlertTitle>
              <AlertDescription>
                Primeira leitura em {formatDateTime(target.firstViewedAt)}
                {target.lastViewedAt && target.lastViewedAt !== target.firstViewedAt
                  ? `; a última em ${formatDateTime(target.lastViewedAt)}`
                  : ""}
                {target.viewCount > 1 ? ` (${target.viewCount} aberturas).` : "."}
              </AlertDescription>
            </Alert>
          ) : link ? (
            <Alert>
              <EyeOffIcon />
              <AlertTitle>Ainda não foi aberta</AlertTitle>
              <AlertDescription>
                Quando o cliente abrir o link, a data e a hora aparecem aqui e na lista de
                propostas.
              </AlertDescription>
            </Alert>
          ) : null}

          {link ? (
            <Field>
              <FieldTitle>Link da proposta</FieldTitle>
              <CopyField id="proposta-link" value={link.url} label="Link público da proposta" />
              <FieldDescription>Vale até {formatDateTime(link.expiresAt)}.</FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldTitle id="proposta-validade">Por quanto tempo o link vale</FieldTitle>
              <ToggleGroup
                aria-labelledby="proposta-validade"
                variant="outline"
                spacing={2}
                value={[String(days)]}
                onValueChange={(value) => {
                  const first = value[0]

                  if (first) {
                    setDays(Number(first))
                  }
                }}
                disabled={isSaving || !target.canShare}
              >
                {PROPOSAL_SHARE_DAY_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option} value={String(option)}>
                    {option} dias
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                Depois do prazo o endereço para de funcionar. Você pode gerar outro quando quiser.
              </FieldDescription>
            </Field>
          )}

          {link && message ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                render={
                  <a
                    href={buildWhatsAppShareUrl(message)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                nativeButton={false}
              >
                <MessageCircleIcon data-icon="inline-start" />
                Abrir no WhatsApp
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(message, "Mensagem copiada.")}
              >
                <LinkIcon data-icon="inline-start" />
                Copiar mensagem
              </Button>
              <Button
                variant="outline"
                size="sm"
                render={<a href={target.pdfUrl} />}
                nativeButton={false}
              >
                <DownloadIcon data-icon="inline-start" />
                Baixar PDF
              </Button>
            </div>
          ) : null}

          {target.canShare ? null : (
            <Alert variant="destructive">
              <AlertTitle>Sem permissão para gerar o link</AlertTitle>
              <AlertDescription>
                Só o corretor da proposta ou quem edita o imóvel pode criar ou desativar o link.
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        <DialogFooter>
          {link && target.canShare ? (
            <>
              <Button variant="ghost" disabled={isSaving} onClick={runRevoke}>
                Desativar link
              </Button>
              <Button variant="outline" disabled={isSaving} onClick={() => runShare(true)}>
                {isSaving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                Gerar novo link
              </Button>
            </>
          ) : null}
          {link ? (
            <DialogClose render={<Button />}>Concluir</DialogClose>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
                Cancelar
              </DialogClose>
              <Button disabled={isSaving || !target.canShare} onClick={() => runShare(false)}>
                {isSaving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <LinkIcon data-icon="inline-start" />
                )}
                Gerar link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
