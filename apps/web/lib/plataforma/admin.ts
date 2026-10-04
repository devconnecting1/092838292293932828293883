import "server-only"

import { unstable_cache } from "next/cache"
import { notFound } from "next/navigation"
import { cache } from "react"

import {
  isPlatformAdminEmail,
  parsePlatformAdminEmails,
} from "@workspace/core/caixa/platform-admins"
import {
  canActOnPlatform,
  canManagePlatformTeam,
  hasPlatformRole,
  isPlatformStaffRole,
  type PlatformRole,
  type PlatformStaffRole,
} from "@workspace/core/platform/staff"

import { getCurrentUser } from "@/lib/auth/session"
import { createPlatformServerKeyClient } from "@/lib/plataforma/server-key-client"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Equipe da plataforma: área interna fora do CRM das imobiliárias.
 *
 * Quem entra (sempre logado com e-mail CONFIRMADO):
 * - Dono (`owner`): e-mail em `PLATFORM_ADMIN_EMAILS` (lista separada por
 *   vírgula, sem diferenciar maiúsculas). É a raiz e o único que gerencia a
 *   equipe;
 * - Administrador (`admin`) e Somente leitura (`viewer`): pessoa ativa em
 *   `private.platform_staff`, que entrou por convite (/plataforma/equipe).
 *
 * O resto recebe 404, sem pista de que a página existe. A regra vale no
 * servidor — em cada página, rota e Server Action —, não em esconder link. O
 * papel é lido do banco a cada requisição: remover alguém ou mudar o papel vale
 * no próximo clique.
 */

export type { PlatformRole }

export type PlatformAdmin = { id: string; email: string; role: PlatformRole }

const MAX_OWNERS = 20

/** Donos da variável do servidor (minúsculas, sem repetição, até 20). */
export function getPlatformOwnerEmails(): string[] {
  return [...parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)].slice(0, MAX_OWNERS)
}

/**
 * Papel ativo da conta na equipe (admin ou viewer) pelo banco, ou null. Uma
 * consulta por conta por requisição. Sem PLATFORM_SERVER_KEY, ninguém do banco
 * entra (só os Donos).
 */
async function fetchPlatformStaffRole(userId: string): Promise<PlatformStaffRole | null> {
  const client = createPlatformServerKeyClient()

  if (!client) {
    return null
  }

  const { data, error } = await client.supabase.rpc("platform_staff_role", {
    p_server_key: client.serverKey,
    p_user_id: userId,
  })

  if (error) {
    // Só o código: o texto do banco pode ter dados.
    console.error(
      `[plataforma] platform_staff_role falhou (código ${error.code ?? "desconhecido"})`
    )
    return null
  }

  return isPlatformStaffRole(data) ? data : null
}

const readPlatformStaffRole = cache(fetchPlatformStaffRole)

/**
 * Só para decidir se o ATALHO do Console aparece no CRM: guarda o papel por 60 s
 * entre requisições, para o layout do CRM não consultar o banco a cada página
 * de cada cliente. Acesso ao console nunca usa esta versão (lê o banco na hora).
 */
function readPlatformStaffRoleForShortcut(userId: string) {
  return unstable_cache(() => fetchPlatformStaffRole(userId), ["platform-staff-role", userId], {
    revalidate: 60,
  })()
}

/**
 * Pessoa da equipe na requisição atual, com o papel, ou null. A identidade vem
 * de `auth.getUser()` (consulta o Auth), e não só do JWT, para exigir o e-mail
 * confirmado: sem isso, alguém poderia criar conta com o e-mail da equipe.
 */
export const getPlatformAdmin = cache(async (): Promise<PlatformAdmin | null> => {
  if (!isSupabaseConfigured()) {
    return null
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  const user = data?.user

  if (error || !user?.email || !user.email_confirmed_at) {
    return null
  }

  const email = user.email.toLowerCase()

  if (isPlatformAdminEmail(email, process.env.PLATFORM_ADMIN_EMAILS)) {
    return { id: user.id, email, role: "owner" }
  }

  const role = await readPlatformStaffRole(user.id)

  return role ? { id: user.id, email, role } : null
})

/** Pode executar ações do console (Dono e Administrador; Somente leitura não). */
export function canAct(admin: Pick<PlatformAdmin, "role"> | null | undefined): boolean {
  return canActOnPlatform(admin?.role)
}

/** Pode convidar, mudar o papel e remover pessoas da equipe (só o Dono). */
export function canManageTeam(admin: Pick<PlatformAdmin, "role"> | null | undefined): boolean {
  return canManagePlatformTeam(admin?.role)
}

/**
 * O atalho para o Console aparece no CRM? Só decide se o link é mostrado: o
 * console confere tudo de novo em cada página.
 *
 * Barato para os clientes: sem sessão, nada é consultado. Dono (variável) passa
 * por `getPlatformAdmin()` como antes. Os demais usam a sessão já lida pelo CRM
 * (`getCurrentUser`, memoizada) e uma consulta do papel no banco, sem nova
 * chamada ao Auth.
 */
export async function canOpenPlatformConsole(email: string | null): Promise<boolean> {
  if (!email) {
    return false
  }

  if (isPlatformAdminEmail(email, process.env.PLATFORM_ADMIN_EMAILS)) {
    return (await getPlatformAdmin()) !== null
  }

  const user = await getCurrentUser()

  if (!user?.email || user.email.toLowerCase() !== email.trim().toLowerCase()) {
    return false
  }

  return (await readPlatformStaffRoleForShortcut(user.id)) !== null
}

/** Exige pessoa da equipe (qualquer papel); senão 404. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    notFound()
  }

  return admin
}

/**
 * Exige pessoa da equipe com pelo menos o papel pedido; senão 404. Para páginas
 * que só fazem sentido para quem age ou gerencia. Telas que todos veem usam
 * `requirePlatformAdmin()` e desabilitam os botões com `canAct`/`canManageTeam`.
 */
export async function requirePlatformRole(min: PlatformRole): Promise<PlatformAdmin> {
  const admin = await requirePlatformAdmin()

  if (!hasPlatformRole(admin.role, min)) {
    notFound()
  }

  return admin
}
