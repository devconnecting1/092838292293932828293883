"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MailIcon, PanelRightOpenIcon, PhoneIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/toast"

import {
  LeadAdPlatformBadges,
  LeadDuplicateBadge,
  LeadRoutingBadges,
  LeadSourceBadge,
  LeadStageBadge,
} from "@/components/leads/lead-badges"
import { LeadStageSelect } from "@/components/leads/lead-stage-select"
import { LeadWhatsappButton } from "@/components/leads/lead-whatsapp-button"
import {
  MobileCard,
  MobileCardList,
  type MobileCardFact,
} from "@/components/mobile-cards/mobile-card"
import { formatDateTime } from "@/lib/format"
import type { Role } from "@/lib/auth/roles"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"
import { registerLeadContact } from "@/lib/leads/actions"
import { getLeadInterestLabel, type LeadContactInput } from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"
import {
  isLeadPhoneViewport,
  isLeadView,
  LEAD_PHONE_DEFAULT_VIEW,
  readLeadPhoneView,
  rememberLeadPhoneView,
} from "@/lib/leads/filters"
import { formatRelativeShort, leadMailtoHref, leadTelHref, maskLeadPhone } from "@/lib/leads/format"
import { canEditLead } from "@/lib/leads/permissions"
import type { LeadItem, LeadSlaSettings } from "@/lib/leads/types"

type LeadsTableProps = {
  leads: LeadItem[]
  members: MemberOption[]
  nowMs: number
  sla: LeadSlaSettings
  currentUserId: string
  role: Role
  onOpenLead: (leadId: string) => void
  onMoveLead: (leadId: string, stage: LeadStage, index: number | null) => void
  /**
   * Registro de contato na volta do WhatsApp do cartão do celular ("Conseguiu
   * falar?", com canal WhatsApp). Sem ele, a
   * lista chama a Server Action direto (sem atualização otimista).
   */
  onMarkContacted?: (leadId: string, contact: LeadContactInput) => void
}

/** Visão em lista (telefone mascarado: o completo fica no detalhe). */
export function LeadsTable({
  leads,
  members,
  nowMs,
  sla,
  currentUserId,
  role,
  onOpenLead,
  onMoveLead,
  onMarkContacted,
}: LeadsTableProps) {
  const [, startContact] = React.useTransition()
  const senderName = members.find((member) => member.id === currentUserId)?.name ?? null

  function markContacted(leadId: string, contact: LeadContactInput) {
    if (onMarkContacted) {
      onMarkContacted(leadId, contact)
      return
    }

    startContact(async () => {
      const result = await registerLeadContact({ leadId, ...contact })

      if (!result.ok) {
        toast.add({
          title: "Não foi possível registrar o contato",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Contato registrado.", type: "success" })
    })
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Imóvel</TableHead>
              <TableHead>Interesse</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Campanha</TableHead>
              <TableHead className="text-end">Entrada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const canMove = canEditLead(role, { assignedTo: lead.assignedTo }, currentUserId)
              const contact = maskLeadPhone(lead.phone) ?? (lead.email ? "E-mail" : "—")

              return (
                <TableRow key={lead.id}>
                  <TableCell className="max-w-64">
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenLead(lead.id)}
                        className="max-w-full truncate rounded-sm text-start font-medium underline-offset-4 outline-hidden hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {lead.name}
                      </button>
                      <div className="flex flex-wrap gap-1 empty:hidden">
                        <LeadRoutingBadges lead={lead} nowMs={nowMs} sla={sla} />
                        <LeadDuplicateBadge hasDuplicate={lead.hasDuplicate} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {canMove ? (
                      <LeadStageSelect
                        size="sm"
                        className="w-40"
                        value={lead.stage}
                        onValueChange={(stage) => onMoveLead(lead.id, stage, null)}
                        aria-label={`Etapa de ${lead.name}`}
                      />
                    ) : (
                      <LeadStageBadge stage={lead.stage} />
                    )}
                  </TableCell>
                  <TableCell className="max-w-48">
                    <div className="flex flex-wrap gap-1">
                      <LeadSourceBadge lead={lead} />
                      <LeadAdPlatformBadges platforms={lead.adPlatforms} />
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {lead.property ? (
                      <span title={lead.property.title}>{lead.property.code}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{getLeadInterestLabel(lead.interest) ?? "—"}</TableCell>
                  <TableCell>
                    {lead.assignedTo ? (
                      getMemberName(members, lead.assignedTo)
                    ) : (
                      <span className="text-muted-foreground">Sem responsável</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{contact}</TableCell>
                  <TableCell className="max-w-40 truncate">{lead.utm.campaign ?? "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    <time dateTime={lead.createdAt} title={formatDateTime(lead.createdAt)}>
                      {formatRelativeShort(lead.createdAt, nowMs)}
                    </time>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <MobileCardList aria-label="Leads">
        {leads.map((lead) => (
          <LeadMobileCard
            key={lead.id}
            lead={lead}
            members={members}
            nowMs={nowMs}
            sla={sla}
            canMove={canEditLead(role, { assignedTo: lead.assignedTo }, currentUserId)}
            senderName={senderName}
            onOpen={() => onOpenLead(lead.id)}
            onMoveStage={(stage) => onMoveLead(lead.id, stage, null)}
            onContact={(contact) => markContacted(lead.id, contact)}
          />
        ))}
      </MobileCardList>
    </>
  )
}

type LeadMobileCardProps = {
  lead: LeadItem
  members: MemberOption[]
  nowMs: number
  sla: LeadSlaSettings
  canMove: boolean
  senderName: string | null
  onOpen: () => void
  onMoveStage: (stage: LeadStage) => void
  onContact: (contact: LeadContactInput) => void
}

/**
 * Cartão do celular: quem é, se está fora do prazo, de onde veio e com quem
 * está, com WhatsApp, ligar e abrir a um toque.
 */
function LeadMobileCard({
  lead,
  members,
  nowMs,
  sla,
  canMove,
  senderName,
  onOpen,
  onMoveStage,
  onContact,
}: LeadMobileCardProps) {
  const stageId = React.useId()
  const tel = leadTelHref(lead.phone)
  // E-mail só entra quando não há telefone: o rodapé fica com no máximo 3 ações.
  const mailto = tel ? null : leadMailtoHref(lead.email)
  const interest = getLeadInterestLabel(lead.interest)
  const facts: MobileCardFact[] = []

  if (lead.property) {
    facts.push({
      label: "Imóvel",
      value: (
        <span className="block truncate" title={lead.property.title}>
          <span className="font-mono text-xs">{lead.property.code}</span> {lead.property.title}
        </span>
      ),
    })
  } else if (interest) {
    facts.push({ label: "Interesse", value: interest })
  }

  facts.push(
    {
      label: "Origem",
      value: (
        <span className="flex flex-wrap gap-1">
          <LeadSourceBadge lead={lead} />
          <LeadAdPlatformBadges platforms={lead.adPlatforms} />
        </span>
      ),
    },
    {
      label: "Responsável",
      value: lead.assignedTo ? (
        getMemberName(members, lead.assignedTo)
      ) : (
        <span className="text-muted-foreground">Sem responsável</span>
      ),
    }
  )

  return (
    <MobileCard
      title={
        <button
          type="button"
          onClick={onOpen}
          className="rounded-sm text-start underline-offset-4 outline-hidden hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {lead.name}
        </button>
      }
      description={
        <time dateTime={lead.createdAt} title={formatDateTime(lead.createdAt)}>
          Entrou {formatRelativeShort(lead.createdAt, nowMs)}
        </time>
      }
      badges={
        <>
          {canMove ? null : <LeadStageBadge stage={lead.stage} />}
          <LeadRoutingBadges lead={lead} nowMs={nowMs} sla={sla} />
          <LeadDuplicateBadge hasDuplicate={lead.hasDuplicate} />
        </>
      }
      facts={facts}
      actions={
        <>
          <LeadWhatsappButton
            lead={lead}
            senderName={senderName}
            canRegisterContact={canMove}
            onContact={onContact}
          />
          {tel ? (
            <Button variant="outline" render={<a href={tel} />} nativeButton={false}>
              <PhoneIcon data-icon="inline-start" />
              Ligar
            </Button>
          ) : null}
          {mailto ? (
            <Button variant="outline" render={<a href={mailto} />} nativeButton={false}>
              <MailIcon data-icon="inline-start" />
              E-mail
            </Button>
          ) : null}
          <Button variant="outline" onClick={onOpen}>
            <PanelRightOpenIcon data-icon="inline-start" />
            Abrir
          </Button>
        </>
      }
    >
      {canMove ? (
        <div className="flex items-center gap-3">
          <Label htmlFor={stageId} className="font-normal text-muted-foreground">
            Etapa
          </Label>
          <LeadStageSelect
            id={stageId}
            className="min-w-0 flex-1 data-[size=default]:h-11"
            value={lead.stage}
            onValueChange={onMoveStage}
            aria-label={`Etapa de ${lead.name}`}
          />
        </div>
      ) : null}
    </MobileCard>
  )
}

/**
 * No celular, `/leads` sem visão no endereço abre na lista em cartões (o quadro
 * rola de lado). A escolha explícita da pessoa (`?visao=`) vale e fica guardada
 * para as próximas visitas; no computador nada muda.
 */
export function LeadsPhoneDefaultView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = searchParams.get("visao")

  React.useEffect(() => {
    if (!isLeadPhoneViewport()) return

    if (isLeadView(view)) {
      rememberLeadPhoneView(view)
      return
    }

    const preferred = readLeadPhoneView() ?? LEAD_PHONE_DEFAULT_VIEW

    // Sem `visao`, o servidor escolhe pelo aparelho do pedido (lista no celular,
    // quadro no computador) e pode não ter acertado: a preferência vai sempre
    // explícita no endereço, inclusive o quadro.
    const params = new URLSearchParams(searchParams.toString())
    params.set("visao", preferred)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [view, pathname, router, searchParams])

  return null
}
