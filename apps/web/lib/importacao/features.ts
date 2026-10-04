import { normalizeLabel } from "@workspace/core/import/normalize"

import { getAmenityOptions } from "@/lib/imoveis/amenities"

const FEATURE_BY_LABEL = new Map(
  getAmenityOptions("property").flatMap((option) => [
    [normalizeLabel(option.label), option.value] as const,
    [normalizeLabel(option.value), option.value] as const,
  ])
)

/**
 * Característica escrita na planilha → chave do catálogo de comodidades
 * ("Piscina" → "pool"). O que não está no catálogo entra como texto livre,
 * igual ao cadastro manual.
 */
export function resolveImportFeature(label: string): string {
  return FEATURE_BY_LABEL.get(normalizeLabel(label)) ?? label
}
