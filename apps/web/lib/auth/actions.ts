"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import {
  ORGANIZATION_COOKIE_NAME,
  ORGANIZATION_COOKIE_OPTIONS,
} from "@/lib/auth/organization-cookie"
import { HOME_PATH, isRootOnlyPath, LOGIN_PATH, sanitizeRedirectPath } from "@/lib/auth/routes"
import { getCurrentUser, getMemberships, type Membership } from "@/lib/auth/session"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"
import { buildTenantUrl, isSubdomainTenancy, isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * Encerra a sessão. No modo subdomain em produção o cookie vale para todos os
 * subdomínios, então a saída vale para todas as imobiliárias.
 */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: "local" })
  }

  const cookieStore = await cookies()
  cookieStore.delete(ORGANIZATION_COOKIE_NAME)

  redirect(LOGIN_PATH)
}

/** Membership ativa do usuário atual na imobiliária informada (id validado). */
async function findActiveMembership(organizationId: string): Promise<Membership | null> {
  const parsed = z.guid().safeParse(organizationId)

  if (!parsed.success) {
    return null
  }

  const user = await getCurrentUser()

  if (!user) {
    redirect(LOGIN_PATH)
  }

  const memberships = await getMemberships(user.id)
  return memberships.find((membership) => membership.organizationId === parsed.data) ?? null
}

/**
 * Troca a imobiliária atual no modo single-host. O id só é gravado no cookie
 * depois de conferido contra as memberships ativas do usuário. No modo
 * subdomain a troca é a navegação para o subdomínio (nada é gravado).
 */
export async function switchOrganization(organizationId: string): Promise<ActionResult> {
  if (isSubdomainTenancy()) {
    return { ok: false, error: "Abra a imobiliária pelo endereço dela." }
  }

  const membership = await findActiveMembership(organizationId)

  if (!membership) {
    return { ok: false, error: "Você não faz parte desta imobiliária." }
  }

  const cookieStore = await cookies()
  cookieStore.set(ORGANIZATION_COOKIE_NAME, membership.organizationId, ORGANIZATION_COOKIE_OPTIONS)

  revalidatePath("/", "layout")

  return { ok: true }
}

/**
 * Entra numa imobiliária a partir de /imobiliarias e abre `next` (caminho
 * sanitizado com allowlist). Subdomain: vai ao subdomínio dela. Single-host:
 * grava a escolha no cookie e segue no mesmo host.
 */
export async function enterOrganization(organizationId: string, next: string): Promise<void> {
  const membership = await findActiveMembership(organizationId)
  const requested = sanitizeRedirectPath(next, HOME_PATH)
  const destination = isRootOnlyPath(requested) ? HOME_PATH : requested

  if (!membership) {
    redirect(LOGIN_PATH)
  }

  if (isSubdomainTenancy()) {
    if (!isValidTenantSlug(membership.organization.slug)) {
      redirect(HOME_PATH)
    }

    redirect(buildTenantUrl(membership.organization.slug, destination))
  }

  const cookieStore = await cookies()
  cookieStore.set(ORGANIZATION_COOKIE_NAME, membership.organizationId, ORGANIZATION_COOKIE_OPTIONS)

  revalidatePath("/", "layout")
  redirect(destination)
}
