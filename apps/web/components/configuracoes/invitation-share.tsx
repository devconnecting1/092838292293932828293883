"use client"

import { CopyIcon, MailIcon, MessageCircleIcon } from "lucide-react"

import { APP_ROLE_LABELS, type AppRole } from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"

import { useCopyToClipboard } from "@/components/configuracoes/copy-field"
import {
  buildInvitationMessage,
  buildMailtoUrl,
  buildWhatsAppShareUrl,
} from "@/lib/configuracoes/invitations"
import { formatDateTime } from "@/lib/format"

export type InvitationShareData = {
  email: string
  role: AppRole
  url: string
  expiresAt: string
}

export function getInvitationShareLinks(invitation: InvitationShareData, organizationName: string) {
  const message = buildInvitationMessage({
    organizationName,
    roleLabel: APP_ROLE_LABELS[invitation.role],
    url: invitation.url,
    expiresAtLabel: formatDateTime(invitation.expiresAt),
  })

  return {
    message,
    whatsappUrl: buildWhatsAppShareUrl(message),
    mailtoUrl: buildMailtoUrl(
      invitation.email,
      `Convite para a equipe da ${organizationName}`,
      message
    ),
  }
}

/** Compartilhamento manual do convite (o envio automático por e-mail ainda não existe). */
export function InvitationShareActions({
  invitation,
  organizationName,
}: {
  invitation: InvitationShareData
  organizationName: string
}) {
  const { copy } = useCopyToClipboard()
  const { message, whatsappUrl, mailtoUrl } = getInvitationShareLinks(invitation, organizationName)

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => copy(message, "Mensagem copiada.")}>
        <CopyIcon data-icon="inline-start" />
        Copiar mensagem
      </Button>
      <Button
        variant="outline"
        size="sm"
        render={<a href={whatsappUrl} target="_blank" rel="noopener noreferrer" />}
        nativeButton={false}
      >
        <MessageCircleIcon data-icon="inline-start" />
        Abrir no WhatsApp
      </Button>
      <Button variant="outline" size="sm" render={<a href={mailtoUrl} />} nativeButton={false}>
        <MailIcon data-icon="inline-start" />
        Abrir no e-mail
      </Button>
    </div>
  )
}
