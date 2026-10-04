import type { Enums, Tables, TablesInsert, TablesUpdate } from "@workspace/database/types"

/**
 * Aliases de domínio para os tipos gerados de `leads` e `landing_pages`
 * (packages/database/src/types.ts, a partir da migração
 * 20260915075742_landing_pages_and_leads.sql).
 *
 * Atenção aos grants por coluna dessa migração (nem todo campo do Row pode ir
 * num insert/update do app): ver `leads_before_write`/`landing_pages_before_write`
 * e as cláusulas `grant insert (...)`/`grant update (...)` da migração.
 */

export type LeadStage = Enums<"lead_stage">
export type LeadSource = Enums<"lead_source">
/** Canal de `lead_contact_events` (ligação, WhatsApp, e-mail, presencial). */
export type LeadContactChannel = Enums<"lead_contact_channel">

/** `leads.interest` é texto livre no banco; o app usa estes valores. */
export type LeadInterest = "buy" | "rent" | "invest" | "sell" | "info"

export type LeadRow = Tables<"leads">
export type LeadInsert = TablesInsert<"leads">
export type LeadUpdate = TablesUpdate<"leads">

export type LandingPageRow = Tables<"landing_pages">
