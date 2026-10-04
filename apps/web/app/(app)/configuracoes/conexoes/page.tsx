import type { Metadata } from "next"
import { InfoIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { PageHeading } from "@/components/crm/page-placeholder"
import { ConnectionsPanel } from "@/components/configuracoes/connections-panel"
import { PageShell } from "@/components/shared/page-shell"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { requireRole } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getMetaPublicConfig } from "@/lib/conexoes/config"
import { loadConnections } from "@/lib/conexoes/queries"

export const metadata: Metadata = {
  title: "Conexões",
}

export default async function ConexoesPage() {
  const { membership } = await requireRole(TEAM_MANAGER_ROLES)
  const organizationId = membership.organizationId

  const [connections, members] = await Promise.all([
    loadConnections(organizationId),
    getOrganizationMembers(organizationId),
  ])

  const memberNames = Object.fromEntries(members.map((member) => [member.id, member.name]))
  const canManage = membership.role === "owner" || membership.role === "manager"

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Conexões"
          description="Conecte aqui as contas da própria imobiliária em serviços de terceiros. A conta é da imobiliária, o fornecedor cobra a imobiliária, e a plataforma cobra apenas o software."
        />
      }
    >
      <Alert>
        <InfoIcon />
        <AlertTitle>Como funciona a cobrança</AlertTitle>
        <AlertDescription>
          Nenhum serviço desta tela é revendido pela plataforma. Cada fornecedor fatura a
          imobiliária diretamente, no meio de pagamento cadastrado na conta dele — os valores abaixo
          são informados como referência, e quem manda é a fatura do fornecedor.
        </AlertDescription>
      </Alert>

      <ConnectionsPanel
        connections={connections}
        memberNames={memberNames}
        meta={getMetaPublicConfig()}
        canManage={canManage}
      />
    </PageShell>
  )
}
