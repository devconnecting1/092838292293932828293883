/** Abas da ficha do imóvel (`?aba=`). Arquivo puro: usado no servidor e no navegador. */
export const PROPERTY_DETAIL_TABS = [
  { value: "visao-geral", label: "Visão geral" },
  { value: "midia", label: "Mídia" },
  { value: "proprietarios", label: "Proprietários" },
  { value: "autorizacao", label: "Autorização" },
  { value: "documentos", label: "Documentos" },
  { value: "compativeis", label: "Clientes compatíveis" },
  { value: "chaves-propostas", label: "Chaves e propostas" },
  { value: "historico", label: "Histórico" },
] as const

export type PropertyDetailTab = (typeof PROPERTY_DETAIL_TABS)[number]["value"]

export const DEFAULT_PROPERTY_DETAIL_TAB: PropertyDetailTab = "visao-geral"

export function isPropertyDetailTab(value: unknown): value is PropertyDetailTab {
  return typeof value === "string" && PROPERTY_DETAIL_TABS.some((tab) => tab.value === value)
}

export function propertyTabHref(propertyId: string, tab: PropertyDetailTab) {
  return tab === DEFAULT_PROPERTY_DETAIL_TAB
    ? `/imoveis/${propertyId}`
    : `/imoveis/${propertyId}?aba=${tab}`
}
