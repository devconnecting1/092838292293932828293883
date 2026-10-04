import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { TriangleAlertIcon } from "lucide-react"

import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Separator } from "@workspace/ui/components/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { AuditTimeline } from "@/components/auditoria/audit-timeline"
import { ActivityQuickForm } from "@/components/clientes/activity-quick-form"
import { ActivityTimeline } from "@/components/clientes/activity-timeline"
import { ClientAppointmentsCard } from "@/components/clientes/client-appointments-card"
import { ClientHeader } from "@/components/clientes/client-header"
import { ClientSummary } from "@/components/clientes/client-summary"
import { ClientTasksCard } from "@/components/clientes/client-tasks-card"
import { ClientViewLogger } from "@/components/clientes/client-view-logger"
import { DocumentsPanel } from "@/components/clientes/documents-panel"
import { InterestsPanel } from "@/components/clientes/interests-panel"
import { MatchesPanel } from "@/components/clientes/matches-panel"
import { SharesPanel } from "@/components/clientes/shares-panel"
import { canViewAuditTrail } from "@/lib/auditoria/permissions"
import { getClientAuditEvents } from "@/lib/auditoria/queries"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { getBillingOverview } from "@/lib/billing/queries"
import { getClientDetailData } from "@/lib/clientes/detail-queries"
import type { RawSearchParams } from "@/lib/clientes/filters"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getMemberName, type ClientOption } from "@/lib/clientes/options"
import {
  canDeleteClientData,
  canEditClient,
  canRegisterActivities,
} from "@/lib/clientes/permissions"
import { getClient } from "@/lib/clientes/queries"
import { createClient as createSupabaseClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Cliente",
}

const TAB_VALUES = [
  "historico",
  "perfil",
  "compativeis",
  "documentos",
  "compartilhamento",
  "visitas",
  "alteracoes",
] as const

type ClientePageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<RawSearchParams>
}

function SectionError({ title }: { title: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        Pode ser uma instabilidade momentânea. Recarregue a página.
      </AlertDescription>
    </Alert>
  )
}

export default async function ClientePage({ params, searchParams }: ClientePageProps) {
  const [{ user, membership }, { id }, query] = await Promise.all([
    requireMembership(),
    params,
    searchParams,
  ])
  const organizationId = membership.organizationId
  const client = await getClient(organizationId, id)

  if (!client) {
    notFound()
  }

  const role = membership.role
  const canViewHistory = canViewAuditTrail(role)

  const [members, detail, billing, auditEvents] = await Promise.all([
    getOrganizationMembers(organizationId),
    getClientDetailData(organizationId, client.id),
    getBillingOverview(organizationId),
    canViewHistory
      ? createSupabaseClient().then((supabase) =>
          getClientAuditEvents(supabase, organizationId, client.id)
        )
      : Promise.resolve(null),
  ])

  const canEdit = canEditClient(
    role,
    {
      assignedTo: client.assigned_to,
      createdBy: client.created_by,
      sharedWithMe: detail.shares.some((share) => share.userId === user.id),
      isPropertyOwner: detail.isPropertyOwner,
    },
    user.id
  )
  const canDelete = canDeleteClientData(role)
  const now = new Date()

  const clientOption: ClientOption = {
    id: client.id,
    label: client.name,
    description: CLIENT_KIND_LABELS[client.kind],
  }

  const requestedTab = typeof query.aba === "string" ? query.aba : ""
  const defaultTab =
    (TAB_VALUES as readonly string[]).includes(requestedTab) &&
    (requestedTab !== "compartilhamento" || canEdit) &&
    (requestedTab !== "alteracoes" || canViewHistory)
      ? requestedTab
      : "historico"

  const documents = detail.documents.map((document) => ({
    id: document.id,
    name: document.name,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    uploadedByName: getMemberName(members, document.uploadedBy),
    createdAt: document.createdAt,
  }))

  const shares = detail.shares.map((share) => {
    const member = members.find((item) => item.id === share.userId)

    return {
      id: share.id,
      userName: member?.name ?? "Ex-membro",
      roleLabel: member ? ROLE_LABELS[member.role] : null,
      sharedBy: share.sharedBy,
      sharedByName: getMemberName(members, share.sharedBy),
      createdAt: share.createdAt,
    }
  })

  const shareCandidates = members
    .filter(
      (member) =>
        (member.role === "broker" || member.role === "capturer") &&
        member.id !== client.assigned_to &&
        !detail.shares.some((share) => share.userId === member.id)
    )
    .map((member) => ({
      id: member.id,
      label: `${member.name} · ${ROLE_LABELS[member.role]}`,
    }))

  const activeInterests = detail.interests.filter((interest) => interest.active)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <ClientViewLogger clientId={client.id} />
      <ClientHeader client={client} members={members} canEdit={canEdit} canDelete={canDelete} />
      <ClientSummary client={client} />

      <Tabs defaultValue={defaultTab} className="gap-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="perfil">Perfil de busca</TabsTrigger>
            <TabsTrigger value="compativeis">
              Imóveis compatíveis
              {detail.matches.length > 0 ? ` (${detail.matches.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="documentos">
              Documentos{documents.length > 0 ? ` (${documents.length})` : ""}
            </TabsTrigger>
            {canEdit ? <TabsTrigger value="compartilhamento">Compartilhamento</TabsTrigger> : null}
            <TabsTrigger value="visitas">Visitas e tarefas</TabsTrigger>
            {canViewHistory ? <TabsTrigger value="alteracoes">Alterações</TabsTrigger> : null}
          </TabsList>
        </div>

        <TabsContent value="historico" className="flex flex-col gap-4">
          {canRegisterActivities(role, canEdit) ? (
            <>
              <ActivityQuickForm clientId={client.id} />
              <Separator />
            </>
          ) : null}
          {detail.activitiesFailed ? (
            <SectionError title="Não foi possível carregar o histórico" />
          ) : (
            <ActivityTimeline
              clientId={client.id}
              activities={detail.activities}
              members={members}
              canDelete={canDelete}
            />
          )}
        </TabsContent>

        <TabsContent value="perfil">
          {detail.interestsFailed ? (
            <SectionError title="Não foi possível carregar os perfis de busca" />
          ) : (
            <InterestsPanel
              clientId={client.id}
              interests={detail.interests}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          )}
        </TabsContent>

        <TabsContent value="compativeis">
          {detail.matchesFailed ? (
            <SectionError title="Não foi possível calcular os imóveis compatíveis" />
          ) : (
            <MatchesPanel
              matches={detail.matches}
              hasActiveInterests={activeInterests.length > 0}
              client={clientOption}
              members={members}
              currentUserId={user.id}
              role={role}
            />
          )}
        </TabsContent>

        <TabsContent value="documentos">
          {detail.documentsFailed ? (
            <SectionError title="Não foi possível carregar os documentos" />
          ) : (
            <DocumentsPanel
              clientId={client.id}
              organizationId={organizationId}
              documents={documents}
              canUpload={canEdit}
              canDelete={canDelete}
              uploadsBlocked={billing?.state === "read_only"}
            />
          )}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="compartilhamento">
            <SharesPanel
              clientId={client.id}
              shares={shares}
              candidates={shareCandidates}
              currentUserId={user.id}
              role={role}
            />
          </TabsContent>
        ) : null}

        {auditEvents ? (
          <TabsContent value="alteracoes">
            <AuditTimeline
              result={auditEvents}
              emptyDescription="Quem cadastrou, quem editou e o que mudou nesta ficha aparece aqui, junto com os documentos anexados e removidos."
              retentionNote="As alterações ficam guardadas por 180 dias; as aberturas da ficha e os downloads de documentos, por 5 anos (LGPD). Só o dono e o gerente da imobiliária veem esta aba."
            />
          </TabsContent>
        ) : null}

        <TabsContent value="visitas">
          <div className="grid gap-4 xl:grid-cols-2">
            <ClientAppointmentsCard
              appointments={detail.appointments}
              failed={detail.appointmentsFailed}
              members={members}
              client={clientOption}
              currentUserId={user.id}
              role={role}
              now={now}
            />
            <ClientTasksCard
              openTasks={detail.openTasks}
              doneTasks={detail.doneTasks}
              failed={detail.tasksFailed}
              members={members}
              client={clientOption}
              currentUserId={user.id}
              role={role}
              now={now}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
