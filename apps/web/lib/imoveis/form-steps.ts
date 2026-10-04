import type { PropertyFormField } from "@/lib/imoveis/schema"

export const PROPERTY_FORM_STEPS = [
  {
    key: "dados",
    title: "Dados",
    description: "Título, descrição, tipo e responsáveis.",
    fields: [
      "title",
      "description",
      "externalCode",
      "registryNumber",
      "purpose",
      "usage",
      "type",
      "condominiumId",
      "capturedBy",
      "brokerId",
    ],
  },
  {
    key: "valores",
    title: "Valores",
    description: "Preço conforme a finalidade, condomínio e IPTU.",
    fields: ["salePrice", "rentPrice", "condoFee", "iptuYearly"],
  },
  {
    key: "endereco",
    title: "Endereço",
    description: "Localização e o que aparece nos portais.",
    fields: [
      "postalCode",
      "street",
      "streetNumber",
      "complement",
      "neighborhood",
      "city",
      "state",
      "latitude",
      "longitude",
      "addressDisplay",
    ],
  },
  {
    key: "caracteristicas",
    title: "Características",
    description: "Áreas, cômodos e comodidades.",
    fields: [
      "livingArea",
      "lotArea",
      "bedrooms",
      "suites",
      "bathrooms",
      "parkingSpaces",
      "floor",
      "totalFloors",
      "yearBuilt",
      "furnished",
      "acceptsPets",
      "acceptsExchange",
      "features",
    ],
  },
  {
    key: "midia",
    title: "Mídia",
    description: "Fotos, vídeo e tour virtual.",
    fields: ["videoUrl", "tourUrl"],
  },
  {
    key: "portais",
    title: "Portais",
    description: "Status do anúncio, publicação e sigilo.",
    fields: ["status", "publishedToPortals", "isRestricted"],
  },
] as const satisfies ReadonlyArray<{
  key: string
  title: string
  description: string
  fields: readonly PropertyFormField[]
}>

export type PropertyFormStepKey = (typeof PROPERTY_FORM_STEPS)[number]["key"]

export function isPropertyFormStepKey(value: unknown): value is PropertyFormStepKey {
  return typeof value === "string" && PROPERTY_FORM_STEPS.some((step) => step.key === value)
}

/** Etapa onde se corrige um problema do VRSync (campo de validateVrsyncListing). */
export function findStepForPortalIssue(field: string): PropertyFormStepKey {
  if (field === "title" || field === "description" || field === "externalCode") return "dados"
  if (field.startsWith("prices.")) return "valores"
  if (field.startsWith("address.")) return "endereco"
  if (field === "livingArea" || field === "lotArea") return "caracteristicas"
  if (field.startsWith("images") || field === "videoUrl" || field === "tourUrl") return "midia"
  return "portais"
}

export function findStepForField(field: string): PropertyFormStepKey {
  const step = PROPERTY_FORM_STEPS.find((item) =>
    (item.fields as readonly string[]).includes(field)
  )
  return step?.key ?? "dados"
}
