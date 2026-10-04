import type { Metadata } from "next"

import { ClientAccessDenied } from "@/components/clientes/client-access-denied"
import { ClientForm } from "@/components/clientes/client-form"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { toDateKey } from "@/lib/agenda/datetime"
import { requireMembership } from "@/lib/auth/session"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { canCreateClients } from "@/lib/clientes/permissions"
import { listClientTags } from "@/lib/clientes/queries"
import { EMPTY_CLIENT_FORM_VALUES } from "@/lib/clientes/schemas"

export const metadata: Metadata = {
  title: "Novo cliente",
}

export default async function NovoClientePage() {
  const { user, membership } = await requireMembership()

  if (!canCreateClients(membership.role)) {
    return (
      <ClientAccessDenied
        title="Você não pode cadastrar clientes"
        description="O seu papel nesta imobiliária permite apenas consultar os clientes."
        backHref={CLIENTS_PATH}
        backLabel="Voltar aos clientes"
      />
    )
  }

  const [members, tags] = await Promise.all([
    getOrganizationMembers(membership.organizationId),
    listClientTags(membership.organizationId),
  ])

  return (
    <PageShell
      variant="form"
      header={
        <PageHeading
          title="Novo cliente"
          description="Pessoa física ou jurídica. CPF, CNPJ, telefones e CEP são validados antes de salvar."
        />
      }
    >
      <ClientForm
        mode="create"
        userId={user.id}
        organizationId={membership.organizationId}
        initialValues={{
          ...EMPTY_CLIENT_FORM_VALUES,
          assignedTo: membership.role === "broker" ? user.id : "",
        }}
        members={members}
        role={membership.role}
        existingTags={tags}
        today={toDateKey(new Date())}
      />
    </PageShell>
  )
}
