import "server-only"

import { z } from "zod"

import { createAnonClient } from "@/lib/captacao/public-organization"
import { readOrganizationBrand } from "@/lib/configuracoes/brand"

/**
 * Dados públicos usados para personalizar o e-mail (nome e cor da imobiliária,
 * nome da landing page e imóvel). Vêm das RPCs públicas já existentes, com a
 * chave publishable; nada é gravado. Em falha devolvem null (o e-mail usa o padrão).
 */

export type EmailOrganizationContext = { name: string; primaryColor: string | null }

export type EmailLandingContext = {
  organization: EmailOrganizationContext
  pageName: string | null
  propertyLabel: string | null
}

const organizationSchema = z.object({ name: z.string().min(1), brand: z.unknown() })

const landingSchema = z.object({
  page: z.object({ name: z.string().nullish() }),
  organization: organizationSchema,
  properties: z
    .array(z.object({ id: z.string(), code: z.string().nullish(), title: z.string().nullish() }))
    .nullish(),
})

function toOrganization(value: z.infer<typeof organizationSchema>): EmailOrganizationContext {
  return { name: value.name, primaryColor: readOrganizationBrand(value.brand).primaryColor }
}

function logFailure(rpc: string, detail: string) {
  console.error(`[email] ${rpc} falhou (${detail})`)
}

export async function loadOrganizationContext(
  orgSlug: string
): Promise<EmailOrganizationContext | null> {
  try {
    const { data, error } = await createAnonClient().rpc("get_public_organization", {
      p_slug: orgSlug,
    })

    if (error) {
      logFailure("get_public_organization", `código ${error.code || "desconhecido"}`)
      return null
    }

    const parsed = organizationSchema.safeParse(data)
    return parsed.success ? toOrganization(parsed.data) : null
  } catch (cause) {
    logFailure("get_public_organization", cause instanceof Error ? cause.name : "erro")
    return null
  }
}

export async function loadLandingContext(
  orgSlug: string,
  pageSlug: string,
  propertyId?: string | null
): Promise<EmailLandingContext | null> {
  try {
    const { data, error } = await createAnonClient().rpc("get_public_landing_page", {
      p_org_slug: orgSlug,
      p_page_slug: pageSlug,
    })

    if (error) {
      logFailure("get_public_landing_page", `código ${error.code || "desconhecido"}`)
      return null
    }

    const parsed = landingSchema.safeParse(data)

    if (!parsed.success) {
      return null
    }

    const property = propertyId
      ? parsed.data.properties?.find((item) => item.id === propertyId.toLowerCase())
      : undefined
    const propertyLabel = property
      ? [property.code, property.title].filter(Boolean).join(" - ") || null
      : null

    return {
      organization: toOrganization(parsed.data.organization),
      pageName: parsed.data.page.name ?? null,
      propertyLabel,
    }
  } catch (cause) {
    logFailure("get_public_landing_page", cause instanceof Error ? cause.name : "erro")
    return null
  }
}
