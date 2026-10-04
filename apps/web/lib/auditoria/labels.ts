/**
 * Tradução dos registros de `public.audit_events` para o português de quem
 * trabalha na imobiliária. Arquivo puro: serve no servidor e no navegador.
 *
 * Os gatilhos de auditoria guardam só os NOMES dos campos alterados (nunca os
 * valores), então a tela mostra "quem", "o quê" e "quando" — não o conteúdo.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  insert: "Cadastrou",
  update: "Alterou",
  delete: "Excluiu",
  view: "Abriu a ficha",
  download: "Baixou um arquivo",
  export: "Exportou os dados",
  print: "Imprimiu os dados",
  import: "Importou",
  /** Lixeira (migração trash_bin_and_subject_erasure). */
  trash: "Moveu para a lixeira",
  restore: "Restaurou da lixeira",
  purge: "Excluiu permanentemente",
  anonymize: "Anonimizou os dados pessoais de",
  subject_request: "Atendeu pedido do titular (LGPD) sobre",
  /** Exclusão da imobiliária (migração organization_and_account_deletion). */
  deletion_scheduled: "Agendou a exclusão de",
  deletion_canceled: "Cancelou a exclusão de",
}

/** Complemento do verbo, por tabela auditada. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  properties: "o imóvel",
  clients: "o cliente",
  client_documents: "um documento do cliente",
  /** Dossiê do imóvel (matrícula, IPTU, planta, certidões): envio, remoção e download. */
  property_documents: "um documento do imóvel",
  memberships: "o acesso de um membro",
  leads: "o lead",
  /** Importação de clientes, leads ou imóveis: "Importou uma planilha". */
  import_jobs: "uma planilha",
  /** Exportação de relatório ou base: "Exportou os dados em planilha". */
  data_export: "em planilha",
  organization_permission_settings: "as permissões de exportação",
  organizations: "toda a imobiliária",
}

const PROPERTY_FIELD_LABELS: Record<string, string> = {
  code: "código",
  title: "título",
  description: "descrição",
  purpose: "finalidade",
  usage: "uso",
  type: "tipo",
  status: "status",
  sale_price: "preço de venda",
  rent_price: "preço de aluguel",
  condo_fee: "condomínio",
  iptu_yearly: "IPTU",
  living_area: "área útil",
  lot_area: "área do terreno",
  bedrooms: "quartos",
  suites: "suítes",
  bathrooms: "banheiros",
  parking_spaces: "vagas",
  floor: "andar",
  total_floors: "andares do prédio",
  year_built: "ano de construção",
  features: "características",
  furnished: "mobiliado",
  accepts_pets: "aceita animais",
  accepts_exchange: "aceita permuta",
  postal_code: "CEP",
  street: "rua",
  street_number: "número",
  complement: "complemento",
  neighborhood: "bairro",
  city: "cidade",
  state: "estado",
  latitude: "latitude",
  longitude: "longitude",
  address_display: "exibição do endereço",
  condominium_id: "condomínio",
  captured_by: "captador",
  broker_id: "corretor",
  imob_score: "Nota do Anúncio",
  published_to_portals: "publicação nos portais",
  published_at: "data de publicação",
  is_restricted: "imóvel restrito (sigilo)",
  registry_number: "matrícula",
}

const CLIENT_FIELD_LABELS: Record<string, string> = {
  kind: "tipo de pessoa",
  name: "nome",
  trade_name: "nome fantasia",
  document: "CPF/CNPJ",
  rg: "RG",
  birth_date: "data de nascimento",
  email: "e-mail",
  phone: "telefone",
  whatsapp: "WhatsApp",
  postal_code: "CEP",
  street: "rua",
  street_number: "número",
  complement: "complemento",
  neighborhood: "bairro",
  city: "cidade",
  state: "estado",
  source: "origem",
  tags: "etiquetas",
  assigned_to: "responsável",
  lgpd_consent_at: "consentimento LGPD",
  lgpd_legal_basis: "base legal (LGPD)",
  notes: "observações",
}

const DOCUMENT_FIELD_LABELS: Record<string, string> = {
  client_id: "cliente",
  name: "nome do arquivo",
  storage_path: "arquivo",
  mime_type: "formato",
  size_bytes: "tamanho",
  uploaded_by: "quem enviou",
}

const PROPERTY_DOCUMENT_FIELD_LABELS: Record<string, string> = {
  property_id: "imóvel",
  kind: "tipo de documento",
  description: "descrição",
  valid_until: "validade",
  storage_path: "arquivo",
  mime_type: "formato",
  size_bytes: "tamanho",
  uploaded_by: "quem enviou",
}

const MEMBERSHIP_FIELD_LABELS: Record<string, string> = {
  role: "papel",
  active: "acesso",
  user_id: "pessoa",
}

const PERMISSION_SETTINGS_FIELD_LABELS: Record<string, string> = {
  export_roles: "papéis que exportam",
}

const COMMON_FIELD_LABELS: Record<string, string> = {
  id: "identificador",
  organization_id: "imobiliária",
  created_by: "quem cadastrou",
  created_at: "data de cadastro",
  deleted_at: "lixeira",
  deleted_by: "quem excluiu",
  anonymized_at: "anonimização",
  identification_kept_until: "prazo de guarda da identificação",
}

const FIELD_LABELS_BY_ENTITY: Record<string, Record<string, string>> = {
  properties: PROPERTY_FIELD_LABELS,
  clients: CLIENT_FIELD_LABELS,
  client_documents: DOCUMENT_FIELD_LABELS,
  property_documents: PROPERTY_DOCUMENT_FIELD_LABELS,
  memberships: MEMBERSHIP_FIELD_LABELS,
  organization_permission_settings: PERMISSION_SETTINGS_FIELD_LABELS,
}

/** Nome de coluna do banco em português. Campo desconhecido volta legível. */
export function auditFieldLabel(entity: string, field: string) {
  return (
    FIELD_LABELS_BY_ENTITY[entity]?.[field] ??
    COMMON_FIELD_LABELS[field] ??
    field.replace(/_/g, " ")
  )
}

/** "preço de venda, bairro e fotos" — lista curta, com "e" no fim. */
export function auditFieldsSentence(entity: string, fields: readonly string[]) {
  const labels = fields.map((field) => auditFieldLabel(entity, field))
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
}

export function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? "Registrou uma ação em"
}

export function auditEntityLabel(entity: string) {
  return AUDIT_ENTITY_LABELS[entity] ?? "um registro"
}
