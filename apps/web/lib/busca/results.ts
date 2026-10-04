import { CLIENT_KIND_LABELS, PROPERTY_STATUS_LABELS } from "@workspace/core/properties/enums"

import type { GlobalSearchEntity, GlobalSearchGroup, GlobalSearchItem } from "@/lib/busca/types"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { formatPhone } from "@/lib/clientes/format"
import { isLeadStage, LEAD_STAGE_LABELS, LEADS_PATH } from "@/lib/leads/constants"

/**
 * Linha da RPC search_crm. O tipo gerado declara tudo como não nulo, mas as
 * colunas que não se aplicam ao tipo do resultado chegam null.
 */
export type SearchCrmRow = {
  entity: string
  id: string
  title: string
  code: string | null
  phone: string | null
  status: string
  place: string | null
}

const GROUPS: readonly { entity: GlobalSearchEntity; label: string; path: string }[] = [
  { entity: "client", label: "Clientes", path: CLIENTS_PATH },
  { entity: "lead", label: "Leads", path: LEADS_PATH },
  { entity: "property", label: "Imóveis", path: "/imoveis" },
]

function isPropertyStatus(value: string): value is keyof typeof PROPERTY_STATUS_LABELS {
  return Object.hasOwn(PROPERTY_STATUS_LABELS, value)
}

function describe(row: SearchCrmRow, entity: GlobalSearchEntity) {
  const phone = row.phone ? formatPhone(row.phone) : null
  let parts: (string | null)[]

  if (entity === "client") {
    const kind = row.status === "pf" || row.status === "pj" ? CLIENT_KIND_LABELS[row.status] : null
    parts = [kind, phone]
  } else if (entity === "lead") {
    parts = [isLeadStage(row.status) ? `Etapa: ${LEAD_STAGE_LABELS[row.status]}` : null, phone]
  } else {
    parts = [
      row.code,
      isPropertyStatus(row.status) ? PROPERTY_STATUS_LABELS[row.status] : null,
      row.place,
    ]
  }

  return parts.filter(Boolean).join(" · ")
}

/** Resultados da RPC agrupados na ordem clientes, leads e imóveis (grupo vazio sai). */
export function buildGlobalSearchGroups(rows: readonly SearchCrmRow[]): GlobalSearchGroup[] {
  return GROUPS.flatMap((group) => {
    const items: GlobalSearchItem[] = rows
      .filter((row) => row.entity === group.entity)
      .map((row) => ({
        entity: group.entity,
        id: row.id,
        title: row.title,
        description: describe(row, group.entity),
        href: `${group.path}/${encodeURIComponent(row.id)}`,
      }))

    return items.length > 0 ? [{ entity: group.entity, label: group.label, items }] : []
  })
}
