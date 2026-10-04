import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ClientAccessDenied } from "@/components/clientes/client-access-denied"
import { ClientForm } from "@/components/clientes/client-form"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { toDateKey } from "@/lib/agenda/datetime"
import { requireMembership } from "@/lib/auth/session"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { listClientTags, getClient } from "@/lib/clientes/queries"
import { clientRowToFormValues } from "@/lib/clientes/schemas"

export const metadata: Metadata = {
  title: "Editar cliente",
}

type EditarClientePageProps = {
  params: Promise<{ id: string }>
}

export default async function EditarClientePage({ params }: EditarClientePageProps) {
  const [{ user, membership }, { id }] = await Promise.all([requireMembership(), params])
  const client = await getClient(membership.organizationId, id)

  if (!client) {
    notFound()
  }

  // Se o RLS deixou ver, só o financeiro não pode editar (demais papéis editam o que veem).
  if (membership.role === "finance") {
    return (
      <ClientAccessDenied
        title="Você não pode editar este cliente"
        description="O papel financeiro tem acesso somente de leitura aos clientes."
        backHref={`${CLIENTS_PATH}/${client.id}`}
        backLabel="Voltar à ficha"
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
      header={<PageHeading title="Editar cliente" description={client.name} />}
    >
      <ClientForm
        mode="edit"
        clientId={client.id}
        userId={user.id}
        organizationId={membership.organizationId}
        initialValues={clientRowToFormValues(client)}
        members={members}
        role={membership.role}
        existingTags={tags}
        today={toDateKey(new Date())}
      />
    </PageShell>
  )
}
