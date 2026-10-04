import type { Metadata } from "next"
import { InfoIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { WhatsappTemplatesManager } from "@/components/whatsapp-templates/whatsapp-templates-manager"
import { requireMembership } from "@/lib/auth/session"
import { canEditWhatsappTemplates } from "@/lib/whatsapp-templates/constants"
import { listWhatsappTemplates } from "@/lib/whatsapp-templates/queries"

export const metadata: Metadata = {
  title: "Mensagens de WhatsApp",
}

export default async function WhatsappTemplatesSettingsPage() {
  const { membership } = await requireMembership()
  const canEdit = canEditWhatsappTemplates(membership.role)
  const templates = await listWhatsappTemplates(membership.organizationId)

  return (
    <PageShell
      variant="settings"
      header={
        <PageHeading
          title="Mensagens de WhatsApp"
          description="Modelos de mensagem da imobiliária para o botão de WhatsApp do lead e do imóvel."
        />
      }
    >
      <Alert>
        <InfoIcon />
        <AlertTitle>Como funciona</AlertTitle>
        <AlertDescription>
          O botão de WhatsApp abre a conversa no seu próprio WhatsApp com o texto preenchido — nada
          é enviado sozinho. Use {"{nome}"}, {"{imovel}"}, {"{corretor}"} e {"{link}"} para o texto
          sair com o primeiro nome do cliente, o imóvel, quem envia e a página pública do imóvel.
          {canEdit ? null : " Só o dono e o gerente criam e editam os modelos."}
        </AlertDescription>
      </Alert>

      <WhatsappTemplatesManager templates={templates} canEdit={canEdit} />
    </PageShell>
  )
}
