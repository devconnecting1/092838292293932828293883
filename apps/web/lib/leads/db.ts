import "server-only"

import { createClient } from "@/lib/supabase/server"

/**
 * Cliente Supabase da requisição, tipado com o schema gerado
 * (`leads`/`landing_pages` já estão em @workspace/database/types).
 */
export const createLeadsClient = createClient

export type LeadsServerClient = Awaited<ReturnType<typeof createClient>>
