/**
 * Catálogo de comodidades. Gravamos a chave estável (ex.: "pool") em
 * properties.features e condominiums.amenities; comodidades digitadas pelo
 * usuário ficam como texto livre. A tradução das chaves para os nomes do
 * VRSync fica a cargo do gerador do feed.
 */

export type AmenityScope = "property" | "condominium" | "both"

export type AmenityOption = {
  value: string
  label: string
  scope: AmenityScope
}

export const AMENITY_OPTIONS: readonly AmenityOption[] = [
  { value: "pool", label: "Piscina", scope: "both" },
  { value: "bbq", label: "Churrasqueira", scope: "both" },
  { value: "gym", label: "Academia", scope: "both" },
  { value: "elevator", label: "Elevador", scope: "both" },
  { value: "concierge_24h", label: "Portaria 24h", scope: "both" },
  { value: "balcony", label: "Varanda", scope: "property" },
  { value: "gourmet_balcony", label: "Varanda gourmet", scope: "property" },
  { value: "air_conditioning", label: "Ar-condicionado", scope: "property" },
  { value: "service_area", label: "Área de serviço", scope: "property" },
  {
    value: "built_in_closets",
    label: "Armários planejados",
    scope: "property",
  },
  { value: "backyard", label: "Quintal", scope: "property" },
  { value: "garden", label: "Jardim", scope: "both" },
  { value: "office_room", label: "Escritório", scope: "property" },
  { value: "fireplace", label: "Lareira", scope: "property" },
  { value: "solar_heating", label: "Aquecimento solar", scope: "property" },
  { value: "party_room", label: "Salão de festas", scope: "both" },
  { value: "playground", label: "Playground", scope: "both" },
  { value: "sports_court", label: "Quadra poliesportiva", scope: "both" },
  { value: "sauna", label: "Sauna", scope: "both" },
  { value: "gourmet_space", label: "Espaço gourmet", scope: "both" },
  { value: "kids_room", label: "Brinquedoteca", scope: "condominium" },
  { value: "pet_place", label: "Pet place", scope: "condominium" },
  { value: "coworking", label: "Coworking", scope: "condominium" },
  { value: "bike_rack", label: "Bicicletário", scope: "condominium" },
  { value: "generator", label: "Gerador", scope: "condominium" },
  { value: "laundry", label: "Lavanderia coletiva", scope: "condominium" },
  {
    value: "visitor_parking",
    label: "Vagas para visitantes",
    scope: "condominium",
  },
  { value: "security_cameras", label: "Câmeras de segurança", scope: "both" },
]

const LABELS = new Map(AMENITY_OPTIONS.map((option) => [option.value, option.label]))

export function getAmenityOptions(scope: Exclude<AmenityScope, "both">) {
  return AMENITY_OPTIONS.filter((option) => option.scope === scope || option.scope === "both")
}

/** Rótulo pt-BR da comodidade; texto livre volta como veio. */
export function getAmenityLabel(value: string) {
  return LABELS.get(value) ?? value
}

export function isCatalogAmenity(value: string) {
  return LABELS.has(value)
}

/** Remove vazios e duplicados (sem diferenciar maiúsculas) mantendo a ordem. */
export function normalizeAmenities(values: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ")
    const key = value.toLocaleLowerCase("pt-BR")
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}
