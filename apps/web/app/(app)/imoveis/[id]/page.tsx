import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ClipboardListIcon } from "lucide-react"

import { evaluateListingPublication } from "@workspace/core/properties/listing-publication"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { TabsContent } from "@workspace/ui/components/tabs"

import { AuditTimeline } from "@/components/auditoria/audit-timeline"
import { AuthorizationsPanel } from "@/components/imoveis/detail/authorizations-panel"
import {
  PropertyDetailTabs,
  type PropertyDetailTabItem,
} from "@/components/imoveis/detail/detail-tabs"
import { DocumentsTab } from "@/components/imoveis/detail/documents-tab"
import { KeysProposalsTab } from "@/components/imoveis/detail/keys-proposals-tab"
import { MatchesTab } from "@/components/imoveis/detail/matches-tab"
import { MediaTab } from "@/components/imoveis/detail/media-tab"
import { OverviewTab } from "@/components/imoveis/detail/overview-tab"
import { OwnersPanel } from "@/components/imoveis/detail/owners-panel"
import { PrivacyCard } from "@/components/imoveis/detail/privacy-card"
import { PropertyHeader } from "@/components/imoveis/detail/property-header"
import { PROPERTY_DETAIL_TABS, type PropertyDetailTab } from "@/components/imoveis/detail/tabs"
import type {
  PropertyAccessPerson,
  PropertyShareCandidate,
} from "@/components/imoveis/detail/types"
import { canViewAuditTrail } from "@/lib/auditoria/permissions"
import { getPropertyAuditEvents } from "@/lib/auditoria/queries"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { getBillingOverview } from "@/lib/billing/queries"
import {
  getCondominiumSummary,
  getConvertedCapture,
  getPropertyAuthorizations,
  getPropertyDocuments,
  getPropertyForPage,
  getPropertyKeys,
  getPropertyMatches,
  getPropertyOwners,
  getPropertyProposals,
  getPropertyShares,
} from "@/lib/imoveis/detail-queries"
import { findStepForField } from "@/lib/imoveis/form-steps"
import { isUuid } from "@/lib/imoveis/ids"
import { getListingPublicationSettings } from "@/lib/imoveis/listing-publication"
import {
  computePropertyScore,
  summarizeMedia,
  todayInSaoPaulo,
  validatePropertyForPortals,
} from "@/lib/imoveis/mappers"
import {
  canDeletePropertyRecords,
  canEditProperty,
  canManageProperty,
  canReadCaptureRequests,
} from "@/lib/imoveis/permissions"
import {
  getOrganizationMembers,
  getPropertyMediaRows,
  toMemberNameMap,
  type OrganizationMember,
} from "@/lib/imoveis/queries"
import { getStatusRequirementIssues } from "@/lib/imoveis/schema"
import { createClient } from "@/lib/supabase/server"

type PropertyDetailPageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PropertyDetailPageProps): Promise<Metadata> {
  const { id } = await params
  if (!isUuid(id)) return { title: "Imóvel" }

  const { membership } = await requireMembership()
  const property = await getPropertyForPage(membership.organizationId, id).catch(() => null)

  return { title: property ? property.code : "Imóvel não encontrado" }
}

/**
 * Quem vê o imóvel restrito e por quê (espelho de private.can_view_property_row)
 * e quem ainda pode ser escolhido. Uma pessoa aparece uma vez, pelo motivo mais
 * forte; só o acesso escolhido pode ser removido.
 */
function buildAccessList(
  members: readonly OrganizationMember[],
  property: { captured_by: string | null; broker_id: string | null },
  shares: readonly { userId: string }[]
): { people: PropertyAccessPerson[]; candidates: PropertyShareCandidate[] } {
  const active = members.filter((member) => member.active)
  const sharedIds = new Set(shares.map((share) => share.userId))
  const people: PropertyAccessPerson[] = []

  for (const member of active) {
    let reason: string | null = null
    if (member.role === "owner" || member.role === "manager") reason = "Vê todos os imóveis"
    else if (member.id === property.captured_by) reason = "Captador"
    else if (member.id === property.broker_id) reason = "Corretor responsável"
    else if (sharedIds.has(member.id)) reason = "Acesso escolhido"

    if (reason) {
      people.push({
        userId: member.id,
        name: member.name,
        roleLabel: ROLE_LABELS[member.role],
        reason,
        removable: reason === "Acesso escolhido",
      })
    }
  }

  const withAccess = new Set(people.map((person) => person.userId))
  const candidates = active
    .filter((member) => !withAccess.has(member.id))
    .map((member) => ({
      userId: member.id,
      name: member.name,
      roleLabel: ROLE_LABELS[member.role],
    }))

  return { people, candidates }
}

function memberName(names: Map<string, string>, id: string | null) {
  if (!id) return "—"
  return names.get(id) ?? "Membro removido"
}

export default async function PropertyDetailPage({ params }: PropertyDetailPageProps) {
  const [{ id }, { user, membership }] = await Promise.all([params, requireMembership()])

  if (!isUuid(id)) notFound()

  const organizationId = membership.organizationId
  const property = await getPropertyForPage(organizationId, id)

  if (!property) notFound()

  const supabase = await createClient()
  const role = membership.role
  const canViewHistory = canViewAuditTrail(role)

  const [
    media,
    owners,
    authorizations,
    members,
    condominium,
    matches,
    keys,
    proposals,
    capture,
    auditEvents,
    documents,
    shares,
    billing,
    publicationSettings,
  ] = await Promise.all([
    getPropertyMediaRows(supabase, organizationId, property.id),
    getPropertyOwners(supabase, organizationId, property.id),
    getPropertyAuthorizations(supabase, organizationId, property.id),
    getOrganizationMembers(supabase, organizationId),
    getCondominiumSummary(supabase, organizationId, property.condominium_id),
    getPropertyMatches(supabase, organizationId, property),
    getPropertyKeys(supabase, organizationId, property.id),
    getPropertyProposals(supabase, organizationId, property.id),
    canReadCaptureRequests(role)
      ? getConvertedCapture(supabase, organizationId, property.id)
      : Promise.resolve(null),
    canViewHistory
      ? getPropertyAuditEvents(supabase, organizationId, property.id)
      : Promise.resolve(null),
    getPropertyDocuments(supabase, organizationId, property.id),
    getPropertyShares(supabase, organizationId, property.id),
    getBillingOverview(organizationId),
    getListingPublicationSettings(supabase, organizationId),
  ])

  const canEdit = canEditProperty(role, user.id, property)
  const canDelete = canDeletePropertyRecords(role)
  const canManage = canManageProperty(role, user.id, property)
  const today = todayInSaoPaulo()

  const mediaSummary = summarizeMedia(media)
  const coverPath =
    (mediaSummary.images.find((image) => image.is_cover) ?? mediaSummary.images[0])?.storage_path ??
    null
  const score = computePropertyScore(
    property,
    mediaSummary,
    authorizations.map((item) => ({
      starts_on: item.startsOn,
      ends_on: item.endsOn,
    }))
  )
  const portalValidation = validatePropertyForPortals(property, mediaSummary)
  const publication = evaluateListingPublication({
    status: property.status,
    isRestricted: property.is_restricted,
    publishedToPortals: property.published_to_portals,
    publicPageEnabled: property.public_page_enabled,
    authorizations: authorizations.map((item) => ({
      starts_on: item.startsOn,
      ends_on: item.endsOn,
    })),
    settings: publicationSettings,
    today,
  })

  const requirementIssues = property.status === "draft" ? getStatusRequirementIssues(property) : []
  const firstIssue = requirementIssues[0]
  const completeHref = `/imoveis/${property.id}/editar?etapa=${firstIssue ? findStepForField(firstIssue.field) : "dados"}`
  const issueMessages = requirementIssues.map((issue) => issue.message)

  const memberNames = toMemberNameMap(members)
  const access = buildAccessList(members, property, shares)
  const documentItems = documents.map((document) => ({
    id: document.id,
    kind: document.kind,
    description: document.description,
    validUntil: document.validUntil,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    uploadedByName: memberName(memberNames, document.uploadedBy),
    createdAt: document.createdAt,
  }))
  const ownerOptions = owners.map((owner) => ({
    value: owner.clientId,
    label: owner.clientName ?? "Cliente sem acesso",
  }))

  const counts: Partial<Record<PropertyDetailTab, number>> = {
    midia: mediaSummary.photosCount,
    proprietarios: owners.length,
    autorizacao: authorizations.length,
    documentos: documents.length,
    compativeis: matches.length,
    "chaves-propostas": keys.length + proposals.length,
  }
  const tabs: PropertyDetailTabItem[] = PROPERTY_DETAIL_TABS.filter(
    (tab) => tab.value !== "historico" || canViewHistory
  ).map((tab) => ({
    value: tab.value,
    label: tab.label,
    count: counts[tab.value],
  }))

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PropertyHeader
        property={property}
        coverPath={coverPath}
        score={score.score}
        canEdit={canEdit}
        requirementIssues={issueMessages}
        completeHref={completeHref}
        portalErrors={portalValidation.errors.map((issue) => issue.message)}
        portalWarnings={portalValidation.warnings.map((issue) => issue.message)}
        organizationName={membership.organization.name}
        organizationSlug={membership.organization.slug}
        canDelete={canDeletePropertyRecords(role)}
        publication={publication}
      />

      {canEdit && issueMessages.length > 0 ? (
        <Alert>
          <ClipboardListIcon />
          <AlertTitle>Complete o cadastro para ativar o imóvel</AlertTitle>
          <AlertDescription>
            <p>Para sair do rascunho: {issueMessages.join(" ")}</p>
            <Link href={completeHref}>Completar cadastro</Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <PropertyDetailTabs tabs={tabs}>
        <TabsContent value="visao-geral">
          <OverviewTab
            property={property}
            condominium={condominium}
            capturedByName={memberName(memberNames, property.captured_by)}
            brokerName={memberName(memberNames, property.broker_id)}
            score={score}
            aside={
              <PrivacyCard
                propertyId={property.id}
                restricted={property.is_restricted}
                canManage={canManage}
                people={access.people}
                candidates={access.candidates}
              />
            }
          />
        </TabsContent>
        <TabsContent value="midia">
          <MediaTab
            propertyId={property.id}
            propertyCode={property.code}
            media={mediaSummary}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="proprietarios">
          <OwnersPanel
            propertyId={property.id}
            owners={owners}
            capture={capture}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="autorizacao">
          <AuthorizationsPanel
            propertyId={property.id}
            authorizations={authorizations}
            ownerOptions={ownerOptions}
            today={today}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="documentos">
          <DocumentsTab
            organizationId={organizationId}
            propertyId={property.id}
            documents={documentItems}
            today={today}
            canManage={canManage}
            uploadsBlocked={billing?.state === "read_only"}
          />
        </TabsContent>
        <TabsContent value="compativeis">
          <MatchesTab isActive={property.status === "active"} matches={matches} />
        </TabsContent>
        <TabsContent value="chaves-propostas">
          <KeysProposalsTab propertyId={property.id} keys={keys} proposals={proposals} />
        </TabsContent>
        {auditEvents ? (
          <TabsContent value="historico">
            <AuditTimeline
              result={auditEvents}
              emptyDescription="Quem cadastrou, quem editou e o que mudou neste imóvel aparece aqui."
            />
          </TabsContent>
        ) : null}
      </PropertyDetailTabs>
    </div>
  )
}
