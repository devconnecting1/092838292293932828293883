import "server-only"

import { cache } from "react"

import { parseLandingPublicPayload, type LandingPublicPayload } from "@/lib/landing/types"
import { normalizeOrgSlug, normalizePageSlug } from "@/lib/leads-publicos/slugs"
import { createLandingAnonClient } from "@/lib/leads-publicos/supabase"

export type PublicLandingPage = {
  orgSlug: string
  pageSlug: string
  payload: LandingPublicPayload
}

/**
 * Landing page publicada pelo par de slugs; null se não existir, não estiver
 * publicada ou vier incompleta. Memoizada por renderização com `cache()` do
 * React: page e generateMetadata fazem uma única chamada à RPC.
 */
export const getPublicLandingPage = cache(
  async (rawOrgSlug: string, rawPageSlug: string): Promise<PublicLandingPage | null> => {
    const orgSlug = normalizeOrgSlug(rawOrgSlug)
    const pageSlug = normalizePageSlug(rawPageSlug)

    if (!orgSlug || !pageSlug) {
      return null
    }

    const supabase = createLandingAnonClient()
    const { data, error } = await supabase.rpc("get_public_landing_page", {
      p_org_slug: orgSlug,
      p_page_slug: pageSlug,
    })

    if (error) {
      if (error.code === "P0002") {
        return null
      }

      throw new Error(`Não foi possível carregar a landing page (${error.code || "erro"}).`)
    }

    const payload = parseLandingPublicPayload(data)

    return payload ? { orgSlug, pageSlug, payload } : null
  }
)
