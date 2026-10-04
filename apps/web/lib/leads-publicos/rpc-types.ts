import type {
  LandingLeadOrigin,
  LeadClickIds,
  LeadInterest,
  LeadUtm,
} from "@/lib/leads-publicos/constants"

/**
 * Corpo de p_payload em submit_landing_lead (chaves opcionais vazias são
 * omitidas). Nos tipos gerados (@workspace/database/types) o parâmetro é `Json`;
 * este tipo documenta e confere o formato montado em schemas.ts.
 */
export type LandingLeadPayload = {
  name: string
  email?: string
  phone?: string
  message?: string
  property_id?: string
  interest?: LeadInterest
  /** Nome da tipologia escolhida (até 80). */
  typology?: string
  utm: LeadUtm
  /** Origem do link (?origem=): instagram ou whatsapp; sem ela, "Landing page". */
  origin?: LandingLeadOrigin
  /** gclid, gbraid, wbraid, fbclid, fbc, fbp (cada um até 255). */
  click_ids: LeadClickIds
  /** URL da landing sem dados pessoais (até 500). */
  landing_url?: string
  referrer?: string
  /** UUID compartilhado com os eventos do Meta Pixel/Google (deduplicação). */
  event_id: string
  consent: true
}
