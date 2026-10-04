import type { ContentValues, IdentityValues, PublicationValues } from "@/lib/marketing/schemas"

/** Valores do formulário do editor (seções editadas com react-hook-form). */
export type LandingEditorFormValues = {
  identity: IdentityValues
  content: ContentValues
  publication: PublicationValues
}

/** Seções salvas separadamente (cada uma com a sua Server Action). */
export type LandingEditorSection = "identity" | "content" | "properties" | "leads" | "publication"

export const LANDING_EDITOR_SECTION_LABELS: Record<LandingEditorSection, string> = {
  identity: "Identidade visual",
  content: "Conteúdo",
  properties: "Imóveis",
  leads: "Leads",
  publication: "Divulgação",
}

export type UploadTarget = {
  organizationId: string
  pageId: string
  /** Assinatura em modo leitura: os campos de imagem não enviam arquivos. */
  uploadsBlocked?: boolean
}
