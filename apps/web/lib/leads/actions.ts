"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import {
  INVALID_FIELDS_MESSAGE,
  toFieldErrors,
  type ActionResultWithData,
} from "@/lib/clientes/action-result"
import {
  GENERIC_ERROR_MESSAGE,
  permissionDeniedMessage,
  translateDatabaseError,
} from "@/lib/clientes/db-errors"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getMemberName } from "@/lib/clientes/options"
import { sendNotificationEmail } from "@/lib/email"
import {
  LEAD_CONTACT_CHANNEL_LABELS,
  LEAD_CONTACT_CHANNELS,
  LEAD_STAGE_LABELS,
  LEADS_PATH,
} from "@/lib/leads/constants"
import { createLeadsClient, type LeadsServerClient } from "@/lib/leads/db"
import type { LeadUpdate } from "@/lib/leads/db-types"
import {
  canAssignFromRoulette,
  canChooseLeadAssignee,
  canCreateLeads,
  canDeleteLeads,
  canWorkLeads,
} from "@/lib/leads/permissions"
import { getLeadDetailExtras } from "@/lib/leads/queries"
import {
  leadIdSchema,
  moveLeadSchema,
  newLeadFormSchema,
  toLeadInsertRow,
  type MoveLeadInput,
  type NewLeadFormValues,
} from "@/lib/leads/schemas"
import type { LeadDetailExtras } from "@/lib/leads/types"
import { moveToTrash } from "@/lib/lixeira/actions"

const RENUMBER_BATCH_SIZE = 25

function revalidateLeads(leadId?: string) {
  revalidatePath(LEADS_PATH)

  if (leadId) {
    revalidatePath(`${LEADS_PATH}/${leadId}`)
  }
}

async function isActiveMember(supabase: LeadsServerClient, organizationId: string, userId: string) {
  const { data } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle()

  return Boolean(data)
}

/** Colunas que o aviso de novo lead precisa (e o responsável que ficou de fato). */
const ASSIGNED_LEAD_COLUMNS = "id, name, source, interest, phone, assigned_to"

type AssignedLeadRow = {
  id: string
  name: string
  source: string
  interest: string | null
  phone: string | null
  assigned_to: string | null
}

/**
 * Avisa por e-mail o corretor que ficou com o lead, quando não foi ele próprio
 * quem mexeu. O destinatário não vai no payload: o handler o descobre pela RPC
 * `get_notification_recipients`, que lê o responsável atual do lead. Enviar
 * depois da resposta (`after`) e engolir a falha — e-mail nunca derruba a ação.
 */
function notifyLeadAssignee(params: {
  organizationSlug: string
  organizationId: string
  lead: AssignedLeadRow
  actorId: string
}) {
  const { lead, actorId } = params

  if (!lead.assigned_to || lead.assigned_to === actorId) {
    return
  }

  after(async () => {
    try {
      await sendNotificationEmail("new_lead", {
        organizationSlug: params.organizationSlug,
        organizationId: params.organizationId,
        leadId: lead.id,
        lead: {
          name: lead.name,
          source: lead.source,
          interest: lead.interest,
          phone: lead.phone,
        },
      })
    } catch {
      // Sem detalhes no log: o payload leva nome e telefone do lead.
      console.error("[leads] aviso de novo lead não enviado ao responsável.")
    }
  })
}

/** Registra no histórico do cliente (quando o lead já foi convertido). Falha não bloqueia. */
async function logClientActivity(
  supabase: LeadsServerClient,
  organizationId: string,
  clientId: string,
  body: string
) {
  const { error } = await supabase.from("activities").insert({
    organization_id: organizationId,
    client_id: clientId,
    type: "status_change",
    body,
  })

  if (error) {
    console.error("[leads] histórico do cliente não registrado:", error.code ?? "erro")
  }
}

// -----------------------------------------------------------------------------
// Novo lead manual
// -----------------------------------------------------------------------------

export async function createLead(
  values: NewLeadFormValues
): Promise<ActionResultWithData<{ id: string }>> {
  const parsed = newLeadFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const { user, membership } = await requireMembership()
  const action = "cadastrar leads"

  if (!canCreateLeads(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createLeadsClient()
  const assignedTo = parsed.data.assignedTo || null

  if (assignedTo && !canChooseLeadAssignee(membership.role) && assignedTo !== user.id) {
    const message = "Corretores cadastram leads para si mesmos ou sem responsável."
    return { ok: false, error: message, fieldErrors: { assignedTo: message } }
  }

  if (assignedTo && !(await isActiveMember(supabase, membership.organizationId, assignedTo))) {
    const message = "O responsável precisa ser um membro ativo da imobiliária."
    return { ok: false, error: message, fieldErrors: { assignedTo: message } }
  }

  // O responsável de volta pode não ser o pedido: com o rodízio ligado, quem
  // decide é o trigger da roleta (private.leads_apply_roulette).
  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...toLeadInsertRow(parsed.data),
      organization_id: membership.organizationId,
      assigned_to: assignedTo,
    })
    .select(ASSIGNED_LEAD_COLUMNS)
    .single()

  if (error) {
    // CHECK `leads_consent_at_not_future`: mensagem do banco já em pt-BR.
    if (error.code === "23514" && error.message.toLowerCase().includes("consentimento")) {
      return {
        ok: false,
        error: error.message,
        fieldErrors: { consentDate: error.message },
      }
    }

    return { ok: false, error: translateDatabaseError(error, action) }
  }

  notifyLeadAssignee({
    organizationSlug: membership.organization.slug,
    organizationId: membership.organizationId,
    lead: data,
    actorId: user.id,
  })

  revalidateLeads()

  return { ok: true, data: { id: data.id }, message: "Lead cadastrado." }
}

// -----------------------------------------------------------------------------
// Etapa e ordem
// -----------------------------------------------------------------------------

export async function moveLead(input: MoveLeadInput): Promise<ActionResult> {
  const parsed = moveLeadSchema.safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Movimentação inválida.",
    }
  }

  const { membership } = await requireMembership()
  const action = "mover este lead"

  if (!canWorkLeads(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const { leadId, stage, position, lostReason, renumber } = parsed.data
  const supabase = await createLeadsClient()

  const { data: current, error: loadError } = await supabase
    .from("leads")
    .select("id, stage, client_id")
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (loadError) {
    return { ok: false, error: translateDatabaseError(loadError, action) }
  }

  if (!current) {
    return {
      ok: false,
      error: "Lead não encontrado. Ele pode ter sido removido.",
    }
  }

  const patch: LeadUpdate = { stage }

  if (position !== null) {
    patch.position = position
  }

  if (stage === "lost") {
    patch.lost_reason = lostReason?.trim() ?? null
  } else if (current.stage === "lost") {
    patch.lost_reason = null
  }

  // Mudar a etapa não é contato: o 1º contato vem só de "Registrar contato" ou
  // do WhatsApp com "Conseguiu falar? Sim" (lead_contact_events).

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const others = renumber.filter((item) => item.id !== leadId)
  let renumberFailures = 0

  for (let index = 0; index < others.length; index += RENUMBER_BATCH_SIZE) {
    const results = await Promise.all(
      others
        .slice(index, index + RENUMBER_BATCH_SIZE)
        .map((item) =>
          supabase
            .from("leads")
            .update({ position: item.position })
            .eq("id", item.id)
            .eq("organization_id", membership.organizationId)
            .select("id")
        )
    )

    renumberFailures += results.filter((result) => result.error || result.data?.length === 0).length
  }

  if (renumberFailures > 0) {
    console.error(`[leads] ${renumberFailures} posição(ões) não renumerada(s) na coluna.`)
  }

  const stageChanged = current.stage !== stage

  if (stageChanged && current.client_id) {
    const reason = stage === "lost" && lostReason ? ` Motivo: ${lostReason.trim()}` : ""
    await logClientActivity(
      supabase,
      membership.organizationId,
      current.client_id,
      `Etapa do lead: ${LEAD_STAGE_LABELS[current.stage]} → ${LEAD_STAGE_LABELS[stage]}.${reason}`
    )
  }

  revalidateLeads(leadId)

  return {
    ok: true,
    message: stageChanged ? `Lead movido para ${LEAD_STAGE_LABELS[stage]}.` : "Ordem atualizada.",
  }
}

// -----------------------------------------------------------------------------
// Responsável
// -----------------------------------------------------------------------------

/** Gestão atribui a qualquer membro (ou remove); corretor só assume lead sem responsável. */
export async function assignLead(leadId: string, assigneeId: string | null): Promise<ActionResult> {
  if (
    !leadIdSchema.safeParse(leadId).success ||
    (assigneeId && !z.guid().safeParse(assigneeId).success)
  ) {
    return { ok: false, error: "Responsável inválido." }
  }

  const { user, membership } = await requireMembership()
  const role = membership.role
  const action = "alterar o responsável deste lead"

  if (!canWorkLeads(role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const isClaim = !canChooseLeadAssignee(role)

  if (isClaim && assigneeId !== user.id) {
    return {
      ok: false,
      error: "Corretores só podem assumir leads sem responsável.",
    }
  }

  const supabase = await createLeadsClient()

  if (assigneeId && !(await isActiveMember(supabase, membership.organizationId, assigneeId))) {
    return {
      ok: false,
      error: "O responsável precisa ser um membro ativo da imobiliária.",
    }
  }

  let query = supabase
    .from("leads")
    .update({ assigned_to: assigneeId })
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)

  if (isClaim) {
    query = query.is("assigned_to", null)
  }

  const { data, error } = await query.select(ASSIGNED_LEAD_COLUMNS)

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  const updated = data[0]

  if (!updated) {
    return {
      ok: false,
      error: isClaim
        ? "Este lead já tem responsável. Recarregue a página."
        : permissionDeniedMessage(action),
    }
  }

  notifyLeadAssignee({
    organizationSlug: membership.organization.slug,
    organizationId: membership.organizationId,
    lead: updated,
    actorId: user.id,
  })

  revalidateLeads(leadId)

  return {
    ok: true,
    message: isClaim
      ? "Lead assumido."
      : assigneeId
        ? "Responsável atualizado."
        : "Lead sem responsável.",
  }
}

// -----------------------------------------------------------------------------
// Rodízio (roleta)
// -----------------------------------------------------------------------------

/**
 * Resposta de `public.assign_lead_from_roulette`: `{ ok, assigned_to,
 * queued_until }` na entrega/fila e `{ ok: false, reason }` quando não há para
 * quem mandar. Campos desconhecidos são ignorados.
 */
const rouletteResultSchema = z.object({
  ok: z.boolean(),
  assigned_to: z.guid().nullish(),
  queued_until: z.string().nullish(),
  reason: z.string().nullish(),
})

/** Manda o lead para o próximo corretor da roleta (dono, gerente e assistente). */
export async function assignLeadFromRoulette(leadId: string): Promise<ActionResult> {
  if (!leadIdSchema.safeParse(leadId).success) {
    return { ok: false, error: "Lead inválido." }
  }

  const { membership } = await requireMembership()
  const action = "distribuir leads pelo rodízio"

  if (!canAssignFromRoulette(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createLeadsClient()
  const { data, error } = await supabase.rpc("assign_lead_from_roulette", {
    p_organization_id: membership.organizationId,
    p_lead_id: leadId,
  })

  if (error) {
    // 22023 (rodízio desligado) e P0002 (lead sumiu) já vêm em pt-BR do banco.
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  const parsed = rouletteResultSchema.safeParse(data)

  if (!parsed.success) {
    console.error("[leads] resposta inesperada do rodízio.")
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }

  const result = parsed.data

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "empty_queue"
          ? "Nenhum corretor na fila do rodízio."
          : "Lead não encontrado. Ele pode ter sido removido.",
    }
  }

  revalidateLeads(leadId)

  if (!result.assigned_to) {
    return {
      ok: true,
      message: "Ninguém de plantão agora. O lead entra na fila da próxima janela.",
    }
  }

  const members = await getOrganizationMembers(membership.organizationId)

  return { ok: true, message: `Lead enviado para ${getMemberName(members, result.assigned_to)}.` }
}

// -----------------------------------------------------------------------------
// Contato
// -----------------------------------------------------------------------------

const registerLeadContactSchema = z.object({
  leadId: leadIdSchema,
  channel: z.enum(LEAD_CONTACT_CHANNELS, "Escolha o canal do contato."),
  reached: z.boolean(),
})

export type RegisterLeadContactInput = z.infer<typeof registerLeadContactSchema>

/**
 * "Registrar contato" e a volta do WhatsApp ("Conseguiu falar?"). Grava em
 * `lead_contact_events` com o canal: `reached` (Sim) vira contato no lead pelo
 * banco — último contato e, na primeira vez, o 1º contato (base do prazo e dos
 * relatórios) — e o lead em "Novo" passa para "Em contato"; "Não" grava só a
 * tentativa, sem tirar o lead de "fora do prazo". O instante é sempre o do
 * servidor.
 */
export async function registerLeadContact(input: RegisterLeadContactInput): Promise<ActionResult> {
  const parsed = registerLeadContactSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Contato inválido." }
  }

  const { membership } = await requireMembership()
  const action = "registrar contato neste lead"

  if (!canWorkLeads(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const { leadId, channel, reached } = parsed.data
  const supabase = await createLeadsClient()
  const { data: current, error: loadError } = await supabase
    .from("leads")
    .select("stage, first_contact_at")
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (loadError) {
    return { ok: false, error: translateDatabaseError(loadError, action) }
  }

  if (!current) {
    return {
      ok: false,
      error: "Lead não encontrado. Ele pode ter sido removido.",
    }
  }

  const { error } = await supabase.from("lead_contact_events").insert({
    organization_id: membership.organizationId,
    lead_id: leadId,
    channel,
    reached,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  revalidateLeads(leadId)

  const channelLabel = LEAD_CONTACT_CHANNEL_LABELS[channel]

  if (!reached) {
    return {
      ok: true,
      message: current.first_contact_at
        ? `Tentativa por ${channelLabel} registrada.`
        : `Tentativa por ${channelLabel} registrada. O 1º contato continua pendente.`,
    }
  }

  return {
    ok: true,
    message:
      current.stage === "new"
        ? `Contato por ${channelLabel} registrado. Lead movido para Em contato.`
        : `Contato por ${channelLabel} registrado.`,
  }
}

// -----------------------------------------------------------------------------
// Exclusão: lixeira de 30 dias (definitiva pela lixeira ou pela rotina diária)
// -----------------------------------------------------------------------------

export async function deleteLead(leadId: string): Promise<ActionResult> {
  if (!leadIdSchema.safeParse(leadId).success) {
    return { ok: false, error: "Lead inválido." }
  }

  const { membership } = await requireMembership()

  if (!canDeleteLeads(membership.role)) {
    return { ok: false, error: permissionDeniedMessage("excluir leads") }
  }

  return moveToTrash("lead", leadId)
}

// -----------------------------------------------------------------------------
// Leitura sob demanda (painel lateral)
// -----------------------------------------------------------------------------

/** Linha do tempo, cliente vinculado e histórico dele, quando o painel do lead abre. */
export async function loadLeadDetailExtras(
  leadId: string
): Promise<ActionResultWithData<LeadDetailExtras>> {
  if (!leadIdSchema.safeParse(leadId).success) {
    return { ok: false, error: "Lead inválido." }
  }

  const { membership } = await requireMembership()
  const supabase = await createLeadsClient()

  const { data: lead, error } = await supabase
    .from("leads")
    .select("client_id")
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (error) {
    return { ok: false, error: translateDatabaseError(error, "ver este lead") }
  }

  if (!lead) {
    return {
      ok: false,
      error: "Lead não encontrado. Ele pode ter sido removido.",
    }
  }

  return {
    ok: true,
    data: await getLeadDetailExtras(supabase, membership.organizationId, leadId, lead.client_id),
  }
}

// -----------------------------------------------------------------------------
// Registro de acesso (LGPD: quem viu o quê)
// -----------------------------------------------------------------------------

/**
 * Registra a abertura do detalhe do lead (LGPD). Falha não bloqueia a tela.
 *
 * `public.log_access_event` aceita `p_entity` em ('lead', 'leads') desde a
 * migração `landing_pages_and_leads_followup`; grava sempre como `leads`
 * (mesmo nome usado pelo trigger de auditoria) e exige que o usuário possa
 * ver o lead (senão `P0002`). Segue o padrão de `logClientView`
 * (lib/clientes/actions.ts).
 */
export async function logLeadView(leadId: string): Promise<void> {
  if (!leadIdSchema.safeParse(leadId).success) {
    return
  }

  await requireMembership()

  const supabase = await createLeadsClient()
  const { error } = await supabase.rpc("log_access_event", {
    p_entity: "leads",
    p_entity_id: leadId,
    p_action: "view",
  })

  if (error) {
    console.error("[leads] falha ao registrar acesso ao lead:", error.code ?? "erro")
  }
}
