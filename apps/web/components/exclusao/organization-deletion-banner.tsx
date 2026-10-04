import Link from "next/link"
import { CalendarClockIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import type { Role } from "@/lib/auth/roles"
import { formatDeletionDate, ORGANIZATION_DELETION_HREF } from "@/lib/exclusao/constants"
import { getOrganizationDeletion } from "@/lib/exclusao/queries"

type OrganizationDeletionBannerProps = {
  organizationId: string
  role: Role
}

/**
 * Aviso global da casca do CRM quando o dono agendou a exclusão da imobiliária:
 * explica o modo leitura (a mensagem de erro ao salvar fala em assinatura) e,
 * para o dono, leva ao cancelamento. Falha na leitura: não renderiza nada.
 */
export async function OrganizationDeletionBanner({
  organizationId,
  role,
}: OrganizationDeletionBannerProps) {
  const status = await getOrganizationDeletion(organizationId)

  if (!status?.scheduled || !status.executeAfter) {
    return null
  }

  return (
    <div className="px-4 pt-4 lg:px-6">
      <Alert variant="destructive" role="status">
        <CalendarClockIcon />
        <AlertTitle>
          Esta imobiliária será excluída em {formatDeletionDate(status.executeAfter)}
        </AlertTitle>
        <AlertDescription>
          <p>
            A conta está em modo leitura: dá para ver e exportar tudo, mas não criar nem editar.{" "}
            {role === "owner" ? (
              <Link href={ORGANIZATION_DELETION_HREF}>Cancelar a exclusão</Link>
            ) : (
              "Só o dono pode cancelar a exclusão."
            )}
          </p>
        </AlertDescription>
      </Alert>
    </div>
  )
}
