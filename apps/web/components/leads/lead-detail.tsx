"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowRightLeftIcon,
  CalendarPlusIcon,
  CircleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
  HandIcon,
  HistoryIcon,
  InboxIcon,
  ListTodoIcon,
  MailIcon,
  PhoneCallIcon,
  PhoneIcon,
  ShieldCheckIcon,
  TimerIcon,
  UserCheckIcon,
} from "lucide-react"

import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog"
import { ACTIVITY_ICONS } from "@/components/clientes/activity-icons"
import { AssignRouletteButton } from "@/components/leads/assign-roulette-button"
import { ConvertLeadDialog } from "@/components/leads/convert-lead-dialog"
import { DeleteLeadButton } from "@/components/leads/delete-lead-button"
import { SubjectErasureButton } from "@/components/lixeira/subject-erasure-button"
import { LeadActivityForm } from "@/components/leads/lead-activity-form"
import {
  LeadAdPlatformBadges,
  LeadSourceBadge,
  LeadStageBadge,
} from "@/components/leads/lead-badges"
import { LeadHistoryTimeline } from "@/components/leads/lead-history"
import { LeadStageSelect } from "@/components/leads/lead-stage-select"
import { LeadContactDialog } from "@/components/leads/lead-contact-dialog"
import { LeadWhatsappButton } from "@/components/leads/lead-whatsapp-button"
import { TaskFormDialog } from "@/components/tarefas/task-form-dialog"
import { canScheduleAppointments } from "@/lib/agenda/permissions"
import type { Role } from "@/lib/auth/roles"
import { ACTIVITY_TYPE_LABELS, CLIENTS_PATH } from "@/lib/clientes/constants"
import {
  getMemberName,
  type ClientOption,
  type MemberOption,
  type PropertyOption,
} from "@/lib/clientes/options"
import { formatDate, formatDateTime } from "@/lib/format"
import type { ConvertLeadResult } from "@/lib/leads/convert-actions"
import {
  getLeadInterestLabel,
  LEAD_DUPLICATE_WINDOW_DAYS,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  LEADS_PATH,
  type LeadContactInput,
} from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"
import {
  CLICK_ID_KEYS,
  formatDurationShort,
  formatElapsedShort,
  formatLeadPhone,
  formatRelativeShort,
  getLeadSlaView,
  isLeadWithoutContact,
  leadMailtoHref,
  leadTelHref,
  safeHttpUrl,
  UTM_KEYS,
  UTM_LABELS,
} from "@/lib/leads/format"
import {
  canAssignFromRoulette,
  canChooseLeadAssignee,
  canClaimLead,
  canConvertLead,
  canDeleteLeads,
  canEditLead,
} from "@/lib/leads/permissions"
import type {
  LeadActivityItem,
  LeadDetailExtras,
  LeadItem,
  LeadSlaSettings,
} from "@/lib/leads/types"

const DETAIL_LIST_CLASS =
  "grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-1.5 text-sm [&_dt]:text-muted-foreground"

/** Etapas em que agendar a visita promove o lead para "Visita agendada". */
const BEFORE_VISIT_STAGES: readonly LeadStage[] = ["new", "contacted", "qualified"]

export type LeadDetailProps = {
  lead: LeadItem
  members: MemberOption[]
  currentUserId: string
  role: Role
  nowMs: number
  /** Prazo e rodízio da imobiliária (lead_routing_settings). */
  sla: LeadSlaSettings
  /** null enquanto carrega a linha do tempo, o cliente vinculado e o histórico. */
  extras: LeadDetailExtras | null
  extrasError: string | null
  isPending: boolean
  onStageChange: (stage: LeadStage) => void
  onAssign: (assigneeId: string | null) => void
  /** "Registrar contato" e a volta do WhatsApp: canal e se conseguiu falar. */
  onMarkContacted: (contact: LeadContactInput) => void
  onConverted: (result: ConvertLeadResult) => void
  onActivityAdded: () => void
  onDeleted: () => void
  /** No painel lateral, oferece abrir a página própria do lead. */
  showOpenPageLink: boolean
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = React.useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-sm font-medium">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function LeadDetail({
  lead,
  members,
  currentUserId,
  role,
  nowMs,
  sla,
  extras,
  extrasError,
  isPending,
  onStageChange,
  onAssign,
  onMarkContacted,
  onConverted,
  onActivityAdded,
  onDeleted,
  showOpenPageLink,
}: LeadDetailProps) {
  const access = { assignedTo: lead.assignedTo }
  const canEdit = canEditLead(role, access, currentUserId)
  const canConvert = canConvertLead(role, access, currentUserId)
  const withoutContact = isLeadWithoutContact(lead)
  const slaView = getLeadSlaView(lead, nowMs, sla)
  const overdue = slaView.state === "breached"
  const phone = formatLeadPhone(lead.phone)
  const tel = leadTelHref(lead.phone)
  const mailto = leadMailtoHref(lead.email)
  const interest = getLeadInterestLabel(lead.interest)
  const landingUrlHref = safeHttpUrl(lead.landingUrl)
  const clickIds = lead.clickIds ?? {}
  const hasTrackingIds = Object.keys(clickIds).length > 0 || Boolean(lead.eventId)
  const origin = lead.landingPage
    ? `${LEAD_SOURCE_LABELS[lead.source]} — ${lead.landingPage.name}`
    : LEAD_SOURCE_LABELS[lead.source]

  const property: PropertyOption | null = lead.property
    ? {
        id: lead.property.id,
        label: `${lead.property.code} · ${lead.property.title}`,
        description: null,
      }
    : null
  const client: ClientOption | null = extras?.client
    ? {
        id: extras.client.id,
        label: extras.client.name,
        description: CLIENT_KIND_LABELS[extras.client.kind],
      }
    : null

  function handleVisitScheduled() {
    if (canEdit && BEFORE_VISIT_STAGES.includes(lead.stage)) {
      onStageChange("visit_scheduled")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {withoutContact ? (
        <Alert variant={overdue ? "destructive" : undefined}>
          <TimerIcon />
          <AlertTitle>
            {overdue
              ? `Primeiro contato fora do prazo há ${formatDurationShort(slaView.overdueMs)}`
              : slaView.state === "warning"
                ? `O prazo do primeiro contato acaba em ${slaView.minutesLeft} min`
                : "Aguardando o primeiro contato"}
          </AlertTitle>
          <AlertDescription>
            Sem contato há {formatElapsedShort(lead.createdAt, nowMs)}. A meta desta imobiliária é
            responder em até {sla.slaMinutes} min: quem responde rápido converte muito mais.
            {lead.slaReassignments > 0
              ? ` Este lead já voltou ${lead.slaReassignments}x para o rodízio por estouro do prazo.`
              : ""}
            {lead.slaBreachedAt
              ? " O rodízio não tinha outro corretor disponível: o lead continua com o responsável e a gestão foi avisada."
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      {lead.hasDuplicate ? (
        <Alert>
          <CopyIcon />
          <AlertTitle>Possível duplicado</AlertTitle>
          <AlertDescription>
            {lead.duplicates.length > 0 ? (
              <>
                <p>
                  Mesmo telefone ou e-mail de outros registros nos últimos{" "}
                  {LEAD_DUPLICATE_WINDOW_DAYS} dias. Confira antes de atender para evitar disputa de
                  atendimento e comissão.
                </p>
                <ul className="flex flex-col gap-1">
                  {lead.duplicates.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link
                        href={
                          item.kind === "lead"
                            ? `${LEADS_PATH}/${item.id}`
                            : `${CLIENTS_PATH}/${item.id}`
                        }
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {item.name}
                      </Link>{" "}
                      ·{" "}
                      {item.kind === "lead"
                        ? `Lead${item.stage ? ` em ${LEAD_STAGE_LABELS[item.stage]}` : ""}`
                        : "Cliente"}{" "}
                      ·{" "}
                      {item.matchedBy
                        .map((reason) => (reason === "phone" ? "telefone" : "e-mail"))
                        .join(" e ")}{" "}
                      · {formatDate(item.createdAt)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Existe um cadastro com o mesmo contato atribuído a outra pessoa da equipe.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <DetailSection title="Contato">
        <dl className={DETAIL_LIST_CLASS}>
          <dt>Telefone</dt>
          <dd className="tabular-nums">{phone ?? "Não informado"}</dd>
          <dt>E-mail</dt>
          <dd className="break-all">{lead.email ?? "Não informado"}</dd>
          <dt>Primeiro contato</dt>
          <dd>
            {lead.firstContactAt
              ? `${formatDateTime(lead.firstContactAt)} (${formatRelativeShort(lead.firstContactAt, nowMs)})`
              : "Nenhum contato registrado"}
          </dd>
          {lead.lastContactAt && lead.lastContactAt !== lead.firstContactAt ? (
            <>
              <dt>Último contato</dt>
              <dd>
                {`${formatDateTime(lead.lastContactAt)} (${formatRelativeShort(lead.lastContactAt, nowMs)})`}
              </dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-wrap gap-2">
          <LeadWhatsappButton
            lead={lead}
            senderName={members.find((member) => member.id === currentUserId)?.name ?? null}
            canRegisterContact={canEdit}
            onContact={onMarkContacted}
          />
          {tel ? (
            <Button variant="outline" size="sm" render={<a href={tel} />} nativeButton={false}>
              <PhoneIcon data-icon="inline-start" />
              Ligar
            </Button>
          ) : null}
          {mailto ? (
            <Button variant="outline" size="sm" render={<a href={mailto} />} nativeButton={false}>
              <MailIcon data-icon="inline-start" />
              E-mail
            </Button>
          ) : null}
          {canEdit ? (
            <LeadContactDialog
              leadName={lead.name}
              highlight={withoutContact}
              disabled={isPending}
              onRegister={onMarkContacted}
            />
          ) : null}
        </div>
      </DetailSection>

      <Separator />

      <DetailSection title="Funil">
        <FieldGroup className="gap-4">
          <Field>
            {canEdit ? (
              <>
                <FieldLabel htmlFor="lead-detalhe-etapa">Etapa</FieldLabel>
                <LeadStageSelect
                  id="lead-detalhe-etapa"
                  className="w-full sm:w-64"
                  value={lead.stage}
                  onValueChange={onStageChange}
                />
              </>
            ) : (
              <>
                <FieldTitle>Etapa</FieldTitle>
                <LeadStageBadge stage={lead.stage} />
              </>
            )}
            {lead.stage === "lost" && lead.lostReason ? (
              <FieldDescription>Motivo da perda: {lead.lostReason}</FieldDescription>
            ) : null}
          </Field>
          <Field>
            {canEdit && canChooseLeadAssignee(role) ? (
              <>
                <FieldLabel htmlFor="lead-detalhe-responsavel">Responsável</FieldLabel>
                <LeadAssigneeSelect
                  lead={lead}
                  members={members}
                  currentUserId={currentUserId}
                  onAssign={onAssign}
                />
              </>
            ) : (
              <>
                <FieldTitle>Responsável</FieldTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    {lead.assignedTo ? getMemberName(members, lead.assignedTo) : "Sem responsável"}
                  </span>
                  {canClaimLead(role, access) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => onAssign(currentUserId)}
                    >
                      <HandIcon data-icon="inline-start" />
                      Assumir lead
                    </Button>
                  ) : null}
                </div>
              </>
            )}
            {sla.rouletteEnabled && canAssignFromRoulette(role) ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <AssignRouletteButton leadId={lead.id} disabled={isPending} />
                </div>
                <FieldDescription>
                  {lead.routingDueAt
                    ? "Ninguém de plantão quando o lead chegou: ele entra na próxima janela do rodízio."
                    : "Manda o lead para o próximo corretor da fila do rodízio."}
                </FieldDescription>
              </>
            ) : null}
          </Field>
        </FieldGroup>
      </DetailSection>

      <Separator />

      <DetailSection title="Interesse">
        <dl className={DETAIL_LIST_CLASS}>
          <dt>Interesse</dt>
          <dd>{interest ?? "Não informado"}</dd>
          {lead.typology ? (
            <>
              <dt>Tipologia</dt>
              <dd>{lead.typology}</dd>
            </>
          ) : null}
          <dt>Imóvel</dt>
          <dd className="min-w-0">
            {lead.property ? (
              <Link
                href={`/imoveis/${lead.property.id}`}
                className="underline-offset-4 hover:underline"
              >
                <span className="font-mono">{lead.property.code}</span> · {lead.property.title}
              </Link>
            ) : lead.propertyId ? (
              "Imóvel removido ou indisponível"
            ) : (
              "Nenhum imóvel específico"
            )}
          </dd>
        </dl>
        {lead.message ? (
          <p className="rounded-lg bg-muted/50 p-3 text-sm wrap-break-word whitespace-pre-wrap">
            {lead.message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">O lead não deixou mensagem.</p>
        )}
      </DetailSection>

      <Separator />

      <DetailSection title="Origem">
        <dl className={DETAIL_LIST_CLASS}>
          <dt>Origem</dt>
          <dd className="flex min-w-0 flex-wrap gap-1">
            <LeadSourceBadge lead={lead} />
          </dd>
          {lead.landingPageId ? (
            <>
              <dt>Landing page</dt>
              <dd className="min-w-0 wrap-break-word">
                {lead.landingPage ? (
                  <>
                    {lead.landingPage.name}{" "}
                    <span className="text-muted-foreground">/{lead.landingPage.slug}</span>
                  </>
                ) : (
                  "Página removida ou indisponível"
                )}
              </dd>
            </>
          ) : null}
          {lead.adPlatforms.length > 0 ? (
            <>
              <dt>Anúncio</dt>
              <dd className="flex flex-wrap gap-1">
                <LeadAdPlatformBadges platforms={lead.adPlatforms} />
              </dd>
            </>
          ) : null}
          {UTM_KEYS.map((key) =>
            lead.utm[key] ? (
              <React.Fragment key={key}>
                <dt>{UTM_LABELS[key]}</dt>
                <dd className="break-all">{lead.utm[key]}</dd>
              </React.Fragment>
            ) : null
          )}
          {lead.landingUrl ? (
            <>
              <dt>Página de entrada</dt>
              <dd className="break-all">
                {landingUrlHref ? (
                  <a
                    href={landingUrlHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    {lead.landingUrl}
                  </a>
                ) : (
                  lead.landingUrl
                )}
              </dd>
            </>
          ) : null}
          {lead.referrer ? (
            <>
              <dt>Veio de</dt>
              <dd className="break-all">{lead.referrer}</dd>
            </>
          ) : null}
          <dt>Recebido em</dt>
          <dd>{formatDateTime(lead.createdAt)}</dd>
        </dl>
        {hasTrackingIds ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-xs font-medium">
              Identificadores de rastreamento{" "}
              <span className="font-normal text-muted-foreground">
                (visível só para dono e gerente)
              </span>
            </p>
            <dl className={`${DETAIL_LIST_CLASS} text-xs`}>
              {CLICK_ID_KEYS.map((key) =>
                clickIds[key] ? (
                  <React.Fragment key={key}>
                    <dt className="font-mono">{key}</dt>
                    <dd className="font-mono break-all">{clickIds[key]}</dd>
                  </React.Fragment>
                ) : null
              )}
              {lead.eventId ? (
                <>
                  <dt className="font-mono">event_id</dt>
                  <dd className="font-mono break-all">{lead.eventId}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
      </DetailSection>

      <Separator />

      <DetailSection title="LGPD">
        {lead.consentAt ? (
          <p className="flex items-start gap-2 text-sm">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {/* Fora da landing page, a equipe informa só o dia (o horário gravado não é real). */}
            {lead.source === "landing_page"
              ? `Consentimento para contato registrado em ${formatDateTime(lead.consentAt)}.`
              : `Consentimento para contato informado pela equipe no cadastro, dado em ${formatDate(lead.consentAt)}.`}
          </p>
        ) : (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Sem consentimento registrado</AlertTitle>
            <AlertDescription>
              Na conversão em cliente, escolha a base legal (LGPD) para tratar os dados.
            </AlertDescription>
          </Alert>
        )}
      </DetailSection>

      <Separator />

      <DetailSection title="Cliente">
        {extrasError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível carregar o cliente e o histórico</AlertTitle>
            <AlertDescription>{extrasError}</AlertDescription>
          </Alert>
        ) : lead.clientId ? (
          extras === null ? (
            <Skeleton className="h-16 w-full" />
          ) : client ? (
            <div className="flex flex-col gap-3">
              <Item variant="outline">
                <ItemMedia variant="icon">
                  <UserCheckIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{client.label}</ItemTitle>
                  <ItemDescription>Cliente vinculado a este lead.</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`${CLIENTS_PATH}/${client.id}`} />}
                    nativeButton={false}
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    Abrir ficha
                  </Button>
                </ItemActions>
              </Item>
              {role !== "finance" ? (
                <div className="flex flex-wrap gap-2">
                  {canScheduleAppointments(role) ? (
                    <AppointmentFormDialog
                      members={members}
                      currentUserId={currentUserId}
                      role={role}
                      defaults={{ client, property }}
                      trigger={<Button size="sm" />}
                      onSaved={handleVisitScheduled}
                    >
                      <CalendarPlusIcon data-icon="inline-start" />
                      Agendar visita
                    </AppointmentFormDialog>
                  ) : null}
                  <TaskFormDialog
                    members={members}
                    currentUserId={currentUserId}
                    role={role}
                    defaults={{ client, property, assigneeId: lead.assignedTo }}
                    trigger={<Button size="sm" variant="outline" />}
                  >
                    <ListTodoIcon data-icon="inline-start" />
                    Nova tarefa
                  </TaskFormDialog>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              O cliente vinculado não está disponível para você.
            </p>
          )
        ) : canConvert ? (
          <p className="text-sm text-muted-foreground">
            Crie ou vincule o cliente para agendar visitas, registrar o histórico e acompanhar
            propostas.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Só quem pode editar este lead converte em cliente.
          </p>
        )}
        {/* Fica sempre montado: a tela de sucesso sobrevive à atualização do lead. */}
        <ConvertLeadDialog
          lead={lead}
          members={members}
          currentUserId={currentUserId}
          role={role}
          showTrigger={!lead.clientId && canConvert}
          onConverted={onConverted}
          onVisitScheduled={handleVisitScheduled}
        />
      </DetailSection>

      <Separator />

      <DetailSection title="Histórico">
        <ItemGroup className="gap-2" aria-label="Marcos do lead">
          <Item variant="outline" role="listitem">
            <ItemMedia variant="icon">
              <InboxIcon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>Lead recebido</ItemTitle>
              <ItemDescription>
                {formatDateTime(lead.createdAt)} · {origin}
              </ItemDescription>
            </ItemContent>
          </Item>
          {lead.firstContactAt ? (
            <Item variant="outline" role="listitem">
              <ItemMedia variant="icon">
                <PhoneCallIcon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Primeiro contato</ItemTitle>
                <ItemDescription>{formatDateTime(lead.firstContactAt)}</ItemDescription>
              </ItemContent>
            </Item>
          ) : null}
          {lead.lastContactAt && lead.lastContactAt !== lead.firstContactAt ? (
            <Item variant="outline" role="listitem">
              <ItemMedia variant="icon">
                <PhoneCallIcon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Último contato registrado</ItemTitle>
                <ItemDescription>{formatDateTime(lead.lastContactAt)}</ItemDescription>
              </ItemContent>
            </Item>
          ) : null}
          <Item variant="outline" role="listitem">
            <ItemMedia variant="icon">
              <ArrowRightLeftIcon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>Etapa atual: {LEAD_STAGE_LABELS[lead.stage]}</ItemTitle>
              <ItemDescription>
                Última alteração em {formatDateTime(lead.updatedAt)}
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>

        {/* Vem do banco (lead_stage_events e lead_assignment_events): mostra
            também o que a roleta e o cron do SLA fizeram sozinhos. */}
        {extrasError ? null : (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Etapas e responsáveis</p>
            {extras === null ? (
              <Skeleton className="h-20 w-full" />
            ) : extras.historyFailed ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível carregar a linha do tempo do lead</AlertTitle>
                <AlertDescription>Recarregue a página em instantes.</AlertDescription>
              </Alert>
            ) : (
              <LeadHistoryTimeline events={extras.history} nowMs={nowMs} />
            )}
          </div>
        )}

        {lead.clientId ? (
          <div className="flex flex-col gap-3">
            {role !== "finance" && canEdit ? (
              <LeadActivityForm clientId={lead.clientId} onSaved={onActivityAdded} />
            ) : null}
            {extras === null ? (
              <Skeleton className="h-20 w-full" />
            ) : extras.activitiesFailed ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível carregar o histórico do cliente</AlertTitle>
                <AlertDescription>Recarregue a página em instantes.</AlertDescription>
              </Alert>
            ) : (
              <LeadActivities activities={extras.activities} members={members} />
            )}
            <Button
              variant="link"
              size="sm"
              className="w-fit px-0"
              render={<Link href={`${CLIENTS_PATH}/${lead.clientId}`} />}
              nativeButton={false}
            >
              Ver o histórico completo na ficha do cliente
            </Button>
          </div>
        ) : (
          <Empty className="border py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>Histórico completo depois da conversão</EmptyTitle>
              <EmptyDescription>
                Converta em cliente para registrar o histórico completo: ligações, mensagens,
                visitas e anotações.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </DetailSection>

      {showOpenPageLink || canDeleteLeads(role) ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {showOpenPageLink ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`${LEADS_PATH}/${lead.id}`} />}
                nativeButton={false}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                Abrir página do lead
              </Button>
            ) : (
              <span />
            )}
            {canDeleteLeads(role) ? (
              <div className="flex flex-wrap gap-2">
                <SubjectErasureButton
                  entity="lead"
                  recordId={lead.id}
                  name={lead.name}
                  size="sm"
                  onDone={onDeleted}
                />
                <DeleteLeadButton leadId={lead.id} leadName={lead.name} onDeleted={onDeleted} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function LeadAssigneeSelect({
  lead,
  members,
  currentUserId,
  onAssign,
}: {
  lead: LeadItem
  members: MemberOption[]
  currentUserId: string
  onAssign: (assigneeId: string | null) => void
}) {
  const items: { label: string; value: string | null }[] = [
    { label: "Sem responsável", value: null },
    ...members.map((member) => ({
      label: member.id === currentUserId ? `${member.name} (você)` : member.name,
      value: member.id,
    })),
  ]

  if (lead.assignedTo && !members.some((member) => member.id === lead.assignedTo)) {
    items.push({ label: "Ex-membro", value: lead.assignedTo })
  }

  return (
    <Select
      items={items}
      value={lead.assignedTo}
      onValueChange={(value: string | null) => {
        if (value !== lead.assignedTo) onAssign(value)
      }}
    >
      <SelectTrigger id="lead-detalhe-responsavel" className="w-full sm:w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value ?? "sem-responsavel"} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function LeadActivities({
  activities,
  members,
}: {
  activities: LeadActivityItem[]
  members: MemberOption[]
}) {
  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma atividade registrada no cliente.</p>
  }

  return (
    <ItemGroup className="gap-2" aria-label="Histórico do cliente">
      {activities.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.type]

        return (
          <Item key={activity.id} variant="outline" role="listitem">
            <ItemMedia variant="icon">
              <Icon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>
                {ACTIVITY_TYPE_LABELS[activity.type]}
                <span className="font-normal text-muted-foreground">
                  {formatDateTime(activity.occurredAt)} ·{" "}
                  {getMemberName(members, activity.createdBy, "Sistema")}
                </span>
              </ItemTitle>
              {activity.body ? (
                <p className="text-sm wrap-break-word whitespace-pre-wrap">{activity.body}</p>
              ) : null}
              {activity.property ? (
                <Link
                  href={`/imoveis/${activity.property.id}`}
                  className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  {activity.property.code} · {activity.property.title}
                </Link>
              ) : null}
            </ItemContent>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
