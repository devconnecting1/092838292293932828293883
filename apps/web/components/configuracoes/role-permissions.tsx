import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Badge } from "@workspace/ui/components/badge"

import { ROLE_LABELS, type Role } from "@/lib/auth/roles"
import { ROLE_PERMISSION_ROLES, getRolePermissions } from "@/lib/configuracoes/permissions-matrix"
import { ROLE_DESCRIPTIONS } from "@/lib/configuracoes/roles"

/**
 * O que cada papel pode fazer, área por área. Começa aberto no papel de quem
 * está lendo, que é a dúvida mais comum ("o que eu posso fazer aqui?"), e
 * permite abrir os outros para decidir qual papel dar a quem.
 */
export function RolePermissions({
  actorRole,
  exportRoles,
}: {
  actorRole: Role
  /** Papéis que exportam nesta imobiliária; sem valor, o padrão (dono e gerente). */
  exportRoles?: readonly Role[]
}) {
  return (
    <Accordion defaultValue={[actorRole]} className="gap-0">
      {ROLE_PERMISSION_ROLES.map((role) => (
        <AccordionItem key={role} value={role}>
          <AccordionTrigger>
            <span className="flex flex-wrap items-center gap-2">
              {ROLE_LABELS[role]}
              {role === actorRole ? <Badge variant="secondary">Seu papel</Badge> : null}
              <span className="font-normal text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <dl className="flex flex-col gap-3">
              {getRolePermissions(role, exportRoles).map((area) => (
                <div key={area.id} className="grid gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <dt className="font-medium">{area.title}</dt>
                  <dd className="text-muted-foreground">{area.text}</dd>
                </div>
              ))}
            </dl>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
