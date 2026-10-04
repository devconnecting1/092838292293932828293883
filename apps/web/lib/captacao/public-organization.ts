import "server-only"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cache } from "react"
import { z } from "zod"

import type { Database } from "@workspace/database/types"

import { readOrganizationBrand, type OrganizationBrand } from "@/lib/configuracoes/brand"
import { getSupabaseEnv, SupabaseNotConfiguredError } from "@/lib/supabase/env"

/**
 * Cliente Supabase anônimo (sem cookies nem sessão) para as páginas públicas.
 * Só chama RPCs liberadas para `anon`.
 */
export function createAnonClient() {
  const env = getSupabaseEnv()

  if (!env) {
    throw new SupabaseNotConfiguredError()
  }

  return createSupabaseClient<Database>(env.url, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export type PublicOrganization = {
  slug: string
  name: string
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  /** CRECI J da imobiliária (organizations.creci). */
  creci: string | null
  /**
   * CRECI F do dono, só quando não há CRECI J (corretor autônomo). A RPC não
   * devolve nenhum outro dado do perfil.
   */
  ownerCreci: { number: string; state: string | null } | null
  /** Contrato do módulo de Configurações: primary_color (hex) e logo_url (https). */
  brand: OrganizationBrand
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const organizationSchema = z.object({
  name: z.string().min(1),
  city: z.string().nullish(),
  state: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  creci: z.string().nullish(),
  owner_creci_number: z.string().nullish(),
  owner_creci_state: z.string().nullish(),
  brand: z.unknown(),
})

export function normalizeSlug(value: string) {
  let decoded: string

  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }

  const slug = decoded.trim().toLowerCase()
  return slug.length >= 3 && slug.length <= 48 && SLUG_PATTERN.test(slug) ? slug : null
}

function clean(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null
}

/**
 * Registro profissional para exibir nas páginas públicas: "CRECI 1234-J" da
 * imobiliária ou, sem ele, "CRECI 12345-F/SP" do dono (corretor autônomo).
 */
export function publicCreciLabel(
  organization: Pick<PublicOrganization, "creci" | "ownerCreci">
): string | null {
  const creci = clean(organization.creci?.replace(/^creci\s*/i, ""))

  if (creci) {
    return `CRECI ${creci}`
  }

  const owner = organization.ownerCreci
  const number = clean(owner?.number.replace(/^creci\s*/i, "").replace(/[\s-]*f$/i, ""))

  if (!number) {
    return null
  }

  return owner?.state ? `CRECI ${number}-F/${owner.state}` : `CRECI ${number}-F`
}

/** Dados públicos da imobiliária pelo slug; null se não existir. Memoizado por requisição. */
export const getPublicOrganization = cache(
  async (rawSlug: string): Promise<PublicOrganization | null> => {
    const slug = normalizeSlug(rawSlug)

    if (!slug) {
      return null
    }

    const supabase = createAnonClient()
    const { data, error } = await supabase.rpc("get_public_organization", {
      p_slug: slug,
    })

    if (error) {
      throw new Error(`Não foi possível carregar a imobiliária (${error.code ?? "erro"}).`)
    }

    const parsed = organizationSchema.safeParse(data)

    if (!parsed.success) {
      return null
    }

    const organization = parsed.data
    const creci = clean(organization.creci)
    const ownerCreciNumber = clean(organization.owner_creci_number)

    return {
      slug,
      name: organization.name.trim(),
      city: clean(organization.city),
      state: clean(organization.state),
      phone: clean(organization.phone),
      email: clean(organization.email),
      creci,
      ownerCreci:
        !creci && ownerCreciNumber
          ? { number: ownerCreciNumber, state: clean(organization.owner_creci_state) }
          : null,
      brand: readOrganizationBrand(organization.brand),
    }
  }
)
