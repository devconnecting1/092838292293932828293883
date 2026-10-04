import type { Metadata } from "next"

import { ImportWizard } from "@/components/importacao/import-wizard"
import { RecentImports } from "@/components/importacao/recent-imports"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { requireRole } from "@/lib/auth/session"
import { IMPORT_ROLES } from "@/lib/importacao/constants"
import { getRecentImportJobs } from "@/lib/importacao/jobs"
import { getImportMembers } from "@/lib/importacao/members"

export const metadata: Metadata = {
  title: "Importar planilhas",
}

/** As fotos por link são baixadas no servidor em lotes pequenos, cada um dentro deste tempo. */
export const maxDuration = 60

/**
 * Importação de clientes, leads e imóveis por planilha (.csv ou .xlsx), em
 * passos: tipo, arquivo, colunas, conferência e gravação em lotes. Dono,
 * gerente e assistente; a RPC do banco confere de novo.
 */
export default async function ImportacaoPage() {
  const { user, membership } = await requireRole(IMPORT_ROLES)
  const [members, recentJobs] = await Promise.all([
    getImportMembers(membership.organizationId),
    getRecentImportJobs({
      organizationId: membership.organizationId,
      userId: user.id,
      role: membership.role,
    }),
  ])

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Importar planilhas"
          description="Traga clientes, leads e imóveis do sistema antigo ou do Excel sem digitar de novo."
        />
      }
    >
      <div className="flex flex-col gap-6">
        <ImportWizard members={members} />
        <RecentImports jobs={recentJobs} />
      </div>
    </PageShell>
  )
}
