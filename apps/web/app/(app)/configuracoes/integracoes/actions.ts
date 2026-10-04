"use server"

import { revalidatePath } from "next/cache"

import { isLeadIngestProvider, type LeadIngestProvider } from "@workspace/core/leads/ingest"

import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import {
  buildCanalProWebhookUrl,
  INTEGRATIONS_SETTINGS_PATH,
  isWebhookToken,
} from "@/lib/integracoes/constants"
import { checkPageConnection } from "@/lib/integracoes/meta"
import {
  isLeadIngestConfigured,
  readIntegrationSecret,
  recordIntegrationTest,
  saveIntegrationState,
} from "@/lib/integracoes/rpc"
import { metaConnectionSchema, type MetaConnectionValues } from "@/lib/integracoes/schemas"
import { createClient } from "@/lib/supabase/server"

/**
 * Ações da tela /configuracoes/integracoes. Dono e gerente apenas (o banco
 * confere de novo em cada RPC).
 *
 * A credencial do cliente chega aqui só de passagem: vai direto para a RPC que
 * a grava no Vault e nunca volta para o navegador, para o log ou para o
 * resultado da ação.
 */

const ROLES = TEAM_MANAGER_ROLES
const NOT_CONFIGURED =
  "A entrada de leads ainda não foi configurada neste ambiente. Fale com o suporte."

function readProvider(value: unknown): LeadIngestProvider | null {
  return isLeadIngestProvider(value) ? value : null
}

export type WebhookAddressResult =
  { ok: true; url: string; message: string } | { ok: false; error: string }

/**
 * Liga o recebimento do Canal Pro e devolve o endereço para a imobiliária
 * colar lá. Com `rotate`, gera um endereço novo e derruba o anterior na hora.
 */
export async function enableCanalProWebhook(rotate = false): Promise<WebhookAddressResult> {
  const auth = await getActionMembership(ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("enable_lead_webhook", {
    p_organization_id: auth.context.membership.organizationId,
    p_provider: "canal_pro",
    p_rotate: rotate,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!isWebhookToken(data)) {
    return { ok: false, error: "O banco devolveu um endereço em formato inesperado." }
  }

  revalidatePath(INTEGRATIONS_SETTINGS_PATH)

  return {
    ok: true,
    url: buildCanalProWebhookUrl(data),
    message: rotate
      ? "Endereço novo gerado. Cole-o no Canal Pro agora: o anterior parou de funcionar."
      : "Endereço pronto. Cole-o no Canal Pro para começar a receber.",
  }
}

/** Conecta a conta da Meta da própria imobiliária (Página + token dela). */
export async function connectMetaLeadAds(
  values: MetaConnectionValues
): Promise<FormActionResult<keyof MetaConnectionValues>> {
  const parsed = metaConnectionSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: getFieldErrors<keyof MetaConnectionValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("connect_lead_integration", {
    p_organization_id: auth.context.membership.organizationId,
    p_provider: "meta_lead_ads",
    p_external_account_id: parsed.data.pageId,
    p_credential: parsed.data.accessToken,
    p_account_label: parsed.data.pageName || undefined,
  })

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Esta Página já está conectada em outra imobiliária.",
        fieldErrors: { pageId: "Página já usada em outra conta." },
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidatePath(INTEGRATIONS_SETTINGS_PATH)

  return {
    ok: true,
    message: "Conta conectada. Use “Testar conexão” para confirmar que os leads vão chegar.",
  }
}

export type SimpleActionResult = { ok: true; message: string } | { ok: false; error: string }

export async function disconnectIntegration(provider: unknown): Promise<SimpleActionResult> {
  const key = readProvider(provider)

  if (!key) {
    return { ok: false, error: "Integração desconhecida." }
  }

  const auth = await getActionMembership(ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("disconnect_lead_integration", {
    p_organization_id: auth.context.membership.organizationId,
    p_provider: key,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidatePath(INTEGRATIONS_SETTINGS_PATH)

  return {
    ok: true,
    message:
      key === "canal_pro"
        ? "Desconectado. O endereço anterior parou de funcionar; desative também no Canal Pro."
        : "Desconectado. A credencial que estava guardada aqui foi apagada.",
  }
}

/**
 * Teste de conexão de verdade: fala com a origem com a credencial guardada.
 * Não cria lead nenhum — só registra o resultado no histórico da tela.
 */
export async function testIntegration(provider: unknown): Promise<SimpleActionResult> {
  const key = readProvider(provider)

  if (!key) {
    return { ok: false, error: "Integração desconhecida." }
  }

  const auth = await getActionMembership(ROLES)

  if (!auth.ok) {
    return auth
  }

  if (!isLeadIngestConfigured()) {
    return { ok: false, error: NOT_CONFIGURED }
  }

  const organizationId = auth.context.membership.organizationId

  if (key === "canal_pro") {
    // O Canal Pro não expõe API para consultarmos: quem chama são eles. O que
    // dá para afirmar com honestidade é se o endereço está ligado aqui —
    // a prova final é o primeiro lead chegando, e a tela mostra isso.
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("lead_integrations")
      .select("status, last_event_at")
      .eq("organization_id", organizationId)
      .eq("provider", "canal_pro")
      .maybeSingle()

    if (error) {
      return { ok: false, error: translateDatabaseError(error) }
    }

    if (!data || data.status !== "connected") {
      return { ok: false, error: "Gere o endereço antes de testar." }
    }

    const detail = data.last_event_at
      ? "endereço ativo; já recebemos entregas do Grupo OLX"
      : "endereço ativo; nenhuma entrega recebida ainda"

    await recordIntegrationTest({ organizationId, provider: key, detail })
    await saveIntegrationState({ organizationId, provider: key, tested: true })
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)

    return {
      ok: true,
      message: data.last_event_at
        ? "Endereço ativo e já recebendo. Está tudo certo."
        : "Endereço ativo. O Canal Pro só nos chama quando alguém contata um anúncio seu — o primeiro lead confirma a ligação.",
    }
  }

  const supabase = await createClient()
  const { data: integration, error: readError } = await supabase
    .from("lead_integrations")
    .select("external_account_id, status")
    .eq("organization_id", organizationId)
    .eq("provider", "meta_lead_ads")
    .maybeSingle()

  if (readError) {
    return { ok: false, error: translateDatabaseError(readError) }
  }

  if (!integration?.external_account_id) {
    return { ok: false, error: "Conecte a Página antes de testar." }
  }

  const accessToken = await readIntegrationSecret(organizationId, "meta_lead_ads")

  if (!accessToken) {
    return { ok: false, error: "Não encontramos a credencial guardada. Conecte a conta de novo." }
  }

  const check = await checkPageConnection(integration.external_account_id, accessToken)

  if (!check.ok) {
    await saveIntegrationState({
      organizationId,
      provider: "meta_lead_ads",
      error: check.detail,
      credentialRejected: check.kind === "credencial_recusada",
      tested: true,
    })
    await recordIntegrationTest({
      organizationId,
      provider: "meta_lead_ads",
      detail: `falhou: ${check.detail}`,
    })
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)

    return {
      ok: false,
      error:
        check.kind === "credencial_recusada"
          ? "A Meta recusou o token guardado. Gere um novo token de Página e conecte de novo."
          : `A Meta não respondeu agora (${check.detail}). Tente de novo em instantes.`,
    }
  }

  const { pageName, subscribedToLeadgen } = check.data

  await saveIntegrationState({ organizationId, provider: "meta_lead_ads", tested: true })
  await recordIntegrationTest({
    organizationId,
    provider: "meta_lead_ads",
    detail: subscribedToLeadgen
      ? "token válido e Página inscrita em leadgen"
      : "token válido, mas a Página não está inscrita em leadgen",
  })
  revalidatePath(INTEGRATIONS_SETTINGS_PATH)

  if (!subscribedToLeadgen) {
    return {
      ok: false,
      error: `O token funciona${pageName ? ` (Página “${pageName}”)` : ""}, mas esta Página ainda não está inscrita no campo “leadgen”. Sem isso a Meta não envia os leads.`,
    }
  }

  return {
    ok: true,
    message: `Tudo certo${pageName ? `: Página “${pageName}” conectada e inscrita em leadgen` : ""}.`,
  }
}
