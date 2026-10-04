import { APP_ROLE_LABELS, type AppRole } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"

import { formatDate, formatDateTime } from "@/lib/format"
import type { PlatformOrganizationMember } from "@/lib/plataforma/imobiliarias"

function roleLabel(role: string): string {
  return Object.hasOwn(APP_ROLE_LABELS, role) ? APP_ROLE_LABELS[role as AppRole] : role
}

/**
 * Membros da imobiliária (equipe dela, para suporte): nome, papel e e-mail.
 * Nada de clientes ou leads.
 */
export function MembersList({ members }: { members: PlatformOrganizationMember[] }) {
  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum membro.</p>
  }

  return (
    <ul className="flex flex-col divide-y">
      {members.map((member, index) => (
        <li
          key={member.email ?? `membro-${index}`}
          className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{member.name ?? "Sem nome"}</span>
            <span className="text-xs break-all text-muted-foreground">{member.email ?? "—"}</span>
          </div>
          <div className="flex shrink-0 flex-col gap-1 sm:items-end">
            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary">{roleLabel(member.role)}</Badge>
              {member.active ? null : <Badge variant="outline">Inativo</Badge>}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {member.lastSignInAt
                ? `Último acesso ${formatDateTime(member.lastSignInAt)}`
                : `Desde ${formatDate(member.joinedAt)} · nunca acessou`}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
