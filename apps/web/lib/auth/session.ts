import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { ORGANIZATION_COOKIE_NAME } from "@/lib/auth/organization-cookie"
import { isRole, type Role } from "@/lib/auth/roles"
import {
  ACCESS_DENIED_PATH,
  HOME_PATH,
  LOGIN_PATH,
  ONBOARDING_PATH,
  TENANT_PICKER_PATH,
} from "@/lib/auth/routes"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"
import { getCurrentTenantSlug } from "@/lib/tenant/server"
import { isSubdomainTenancy } from "@/lib/tenant/urls"

export type SessionUser = {
  id: string
  email: string | null
  fullName: string | null
  avatarUrl: string | null
}

export type OrganizationSummary = {
  id: string
  slug: string
  name: string
}

export type Membership = {
  organizationId: string
  role: Role
  organization: OrganizationSummary
}

export type OrganizationContext = {
  user: SessionUser
  memberships: Membership[]
  /**
   * Slug da imobiliária da requisição: o do subdomínio (modo subdomain; null
   * na raiz) ou o da imobiliária escolhida (modo single-host).
   */
  tenantSlug: string | null
  /**
   * Imobiliária atual, sempre entre as memberships ATIVAS do usuário:
   * - subdomain: a do slug do subdomínio (null na raiz ou sem acesso);
   * - single-host: a do cookie `crm_org`, se válida; senão a primeira.
   */
  membership: Membership | null
}

export type MembershipContext = OrganizationContext & {
  tenantSlug: string
  membership: Membership
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/**
 * Usuário autenticado da requisição atual. A identidade vem de getClaims()
 * (JWT validado), nunca de getSession(). Memoizado por requisição.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseConfigured()) {
    return null
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims

  if (error || !claims?.sub) {
    return null
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", claims.sub)
    .maybeSingle()

  const metadata = (claims.user_metadata ?? {}) as Record<string, unknown>

  return {
    id: claims.sub,
    email: readString(claims.email),
    fullName: readString(profile?.full_name) ?? readString(metadata.full_name),
    avatarUrl: readString(profile?.avatar_url),
  }
})

/** Memberships ativas do usuário, com os dados básicos de cada imobiliária. */
export const getMemberships = cache(async (userId: string): Promise<Membership[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("memberships")
    .select("organization_id, role, organizations(id, slug, name)")
    .eq("user_id", userId)
    .eq("active", true)

  if (error) {
    throw new Error(
      `Não foi possível carregar suas imobiliárias (${error.code ?? "erro"}): ${error.message}`
    )
  }

  const memberships: Membership[] = []

  for (const row of data ?? []) {
    const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations

    if (!organization || !isRole(row.role)) {
      continue
    }

    memberships.push({
      organizationId: row.organization_id,
      role: row.role,
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
      },
    })
  }

  return memberships.sort((a, b) => a.organization.name.localeCompare(b.organization.name, "pt-BR"))
})

/**
 * Usuário, memberships e a imobiliária atual. A imobiliária é sempre buscada
 * entre as memberships ATIVAS do usuário (consulta com RLS): o subdomínio ou o
 * cookie só escolhem o tenant, nunca concedem acesso.
 */
export const getOrganizationContext = cache(async (): Promise<OrganizationContext | null> => {
  const user = await getCurrentUser()

  if (!user) {
    return null
  }

  const memberships = await getMemberships(user.id)

  if (isSubdomainTenancy()) {
    const tenantSlug = await getCurrentTenantSlug()
    const membership = tenantSlug
      ? (memberships.find((item) => item.organization.slug === tenantSlug) ?? null)
      : null

    return { user, memberships, tenantSlug, membership }
  }

  const cookieStore = await cookies()
  const selectedId = cookieStore.get(ORGANIZATION_COOKIE_NAME)?.value
  const membership =
    memberships.find((item) => item.organizationId === selectedId) ?? memberships[0] ?? null

  return {
    user,
    memberships,
    tenantSlug: membership?.organization.slug ?? null,
    membership,
  }
})

/** Exige usuário autenticado; senão manda para /entrar. */
export async function requireUser(): Promise<SessionUser> {
  if (!isSupabaseConfigured()) {
    redirect("/")
  }

  const user = await getCurrentUser()

  if (!user) {
    redirect(LOGIN_PATH)
  }

  return user
}

/**
 * Exige membership ativa na imobiliária atual:
 * - sem login: /entrar;
 * - subdomain, domínio raiz (sem tenant): escolha de imobiliária;
 * - subdomain, logado sem membership ativa nesta imobiliária: /sem-acesso;
 * - single-host, sem nenhuma imobiliária: onboarding.
 */
export async function requireMembership(): Promise<MembershipContext> {
  if (!isSupabaseConfigured()) {
    redirect("/")
  }

  const context = await getOrganizationContext()

  if (!context) {
    redirect(LOGIN_PATH)
  }

  const { tenantSlug, membership } = context

  if (isSubdomainTenancy()) {
    if (!tenantSlug) {
      redirect(TENANT_PICKER_PATH)
    }

    if (!membership) {
      redirect(ACCESS_DENIED_PATH)
    }
  } else if (!membership) {
    redirect(ONBOARDING_PATH)
  }

  return { ...context, tenantSlug: membership.organization.slug, membership }
}

/** Exige um dos papéis informados na imobiliária atual; senão volta ao painel. */
export async function requireRole(allowed: readonly Role[]): Promise<MembershipContext> {
  const context = await requireMembership()

  if (!allowed.includes(context.membership.role)) {
    redirect(`${HOME_PATH}?erro=sem-permissao`)
  }

  return context
}
