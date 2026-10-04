import { buildVisitCalendar, ICS_CONTENT_TYPE } from "@workspace/core/email/calendar"
import { formatDisplayAddress } from "@workspace/core/email/reminders"
import { isUuid } from "@workspace/core/email/sanitize"

import { requireMembership } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { buildTenantOrigin } from "@/lib/tenant/urls"

/**
 * Convite da visita em iCalendar (.ics, RFC 5545 —
 * https://www.rfc-editor.org/rfc/rfc5545), gerado na hora:
 * /agenda/visitas/{id}/convite. É o botão "Adicionar ao Google Agenda / Outlook"
 * da agenda e o link do e-mail de lembrete.
 *
 * Exige sessão; a leitura usa a sessão de quem pediu, então o RLS de
 * appointments decide o acesso (visita que a pessoa não vê responde 404, sem
 * distinguir os casos). O arquivo leva imóvel, endereço no modo de exibição do
 * imóvel, ponto de encontro e o link da agenda — nada do cliente.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
}

type PropertyRow = {
  code: string
  title: string
  address_display: string
  street: string | null
  street_number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { membership }] = await Promise.all([params, requireMembership()])

  if (!isUuid(id)) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, status, starts_at, ends_at, meeting_point, property:properties!appointments_property_fkey(code, title, address_display, street, street_number, neighborhood, city, state)"
    )
    .eq("organization_id", membership.organizationId)
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error(
      `[agenda/convite] falha ao carregar a visita (código ${error.code || "desconhecido"})`
    )
    return new Response(null, { status: 500, headers: NOT_FOUND_HEADERS })
  }

  if (!data) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const property = (Array.isArray(data.property) ? data.property[0] : data.property) as
    PropertyRow | null | undefined
  const file = buildVisitCalendar({
    origin: buildTenantOrigin(membership.organization.slug),
    visitId: data.id,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    status: data.status,
    propertyCode: property?.code,
    propertyTitle: property?.title,
    address: property
      ? formatDisplayAddress({
          addressDisplay: property.address_display,
          street: property.street,
          streetNumber: property.street_number,
          neighborhood: property.neighborhood,
          city: property.city,
          state: property.state,
        })
      : null,
    meetingPoint: data.meeting_point,
  })

  if (!file) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  return new Response(file.content, {
    status: 200,
    headers: {
      "Content-Type": ICS_CONTENT_TYPE,
      // attachment: o navegador baixa o .ics e o celular oferece abrir no
      // Google Agenda, no Outlook ou no Calendário.
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}
