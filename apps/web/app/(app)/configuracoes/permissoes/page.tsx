import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { PageHeading } from "@/components/crm/page-placeholder"
import { ExportAuditList } from "@/components/configuracoes/export-audit-list"
import { ExportRolesForm } from "@/components/configuracoes/export-roles-form"
import { RolePermissions } from "@/components/configuracoes/role-permissions"
import { PageShell } from "@/components/shared/page-shell"
import { ROLE_LABELS, TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { getExportAuditEvents, getExportRoles } from "@/lib/configuracoes/export-audit"
import { canExportData, exportRolesLabel } from "@/lib/configuracoes/export-permissions"
import { canViewAuditTrail } from "@/lib/auditoria/permissions"
import { TEAM_SETTINGS_PATH } from "@/components/shared/settings-config"

export const metadata: Metadata = {
  title: "Papéis e permissões",
}

/**
 * Referência aberta a todos os membros: "o que eu posso fazer aqui?" e "que
 * papel a fulana precisa ter?". A tela de Equipe continua só para dono e
 * gerente, porque lá se muda o papel das pessoas.
 *
 * A exportação de dados é a parte configurável: o dono escolhe quais papéis
 * exportam CSV, e dono e gerente acompanham cada exportação (e cada recusa).
 */
export default async function PermissoesPage() {
  const { membership } = await requireMembership()
  const role = membership.role
  const organizationId = membership.organizationId
  const canManageTeam = TEAM_MANAGER_ROLES.includes(role)
  const isOwner = role === "owner"
  const canSeeExports = canViewAuditTrail(role)

  const [exportRoles, exportAudit] = await Promise.all([
    getExportRoles(organizationId),
    canSeeExports ? getExportAuditEvents(organizationId) : null,
  ])

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Papéis e permissões"
          description={`O que cada papel pode fazer na ${membership.organization.name}.`}
        />
      }
    >
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Você é {ROLE_LABELS[role]} nesta imobiliária</AlertTitle>
        <AlertDescription>
          {canManageTeam ? (
            <p>
              Para trocar o papel de alguém ou convidar uma pessoa nova, vá em{" "}
              <Link href={TEAM_SETTINGS_PATH}>Equipe</Link>.
            </p>
          ) : (
            <p>
              Precisa de algo que seu papel não permite? Peça ao dono ou ao gerente da imobiliária —
              são eles que mudam papéis e convidam pessoas.
            </p>
          )}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>O que cada papel faz</CardTitle>
          <CardDescription>
            Estas regras valem no banco de dados, não só na tela: um papel sem permissão não
            consegue a ação nem por atalho ou link direto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolePermissions actorRole={role} exportRoles={exportRoles} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exportação de dados</CardTitle>
          <CardDescription>
            Quem baixa planilhas (CSV) de relatórios, leads, clientes, imóveis e propostas. Cada
            exportação fica registrada com quem, quando, o quê e quantas linhas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <ExportRolesForm exportRoles={exportRoles} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Hoje exportam: {exportRolesLabel(exportRoles)}.{" "}
              {canExportData(role, exportRoles)
                ? "Seu papel está liberado."
                : "Seu papel não exporta."}{" "}
              Só o dono muda esta regra.
            </p>
          )}
        </CardContent>
      </Card>

      {exportAudit ? (
        <Card>
          <CardHeader>
            <CardTitle>Exportações</CardTitle>
            <CardDescription>
              Downloads e tentativas recusadas, do mais recente. Só o dono e o gerente veem esta
              lista.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExportAuditList result={exportAudit} />
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  )
}
