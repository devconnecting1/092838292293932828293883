/**
 * Campos que cada importação aceita, com os nomes de coluna em pt-BR que a
 * sugestão automática reconhece e o exemplo que vai no modelo de planilha.
 * A `key` é o nome da coluna no banco (e a chave enviada à RPC import_batch).
 */

import { normalizeLabel } from "./normalize"

export const IMPORT_KINDS = ["clients", "leads", "properties"] as const

export type ImportKind = (typeof IMPORT_KINDS)[number]

export const IMPORT_DUPLICATE_MODES = ["skip", "update"] as const

export type ImportDuplicateMode = (typeof IMPORT_DUPLICATE_MODES)[number]

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value)
}

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  clients: "Clientes e contatos",
  leads: "Leads",
  properties: "Imóveis",
}

export type ImportField = {
  key: string
  label: string
  /** Dica curta mostrada no mapeamento e no modelo. */
  hint?: string
  /** Valor da linha de exemplo do modelo de planilha. */
  example: string
  /** Nomes de coluna reconhecidos (comparados sem acento e sem pontuação). */
  aliases: readonly string[]
}

export const CLIENT_IMPORT_FIELDS: readonly ImportField[] = [
  {
    key: "name",
    label: "Nome",
    hint: "Obrigatório. Nome completo ou razão social.",
    example: "Maria da Silva",
    aliases: ["nome", "nome completo", "cliente", "razao social", "nome do cliente"],
  },
  {
    key: "phone",
    label: "Telefone",
    hint: "Com DDD. Telefone, WhatsApp, e-mail ou CPF: pelo menos um.",
    example: "(11) 98765-4321",
    aliases: ["telefone", "celular", "fone", "tel", "telefone 1", "telefone principal"],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    hint: "Com DDD.",
    example: "(11) 98765-4321",
    aliases: ["whatsapp", "whats", "zap", "wpp", "celular", "telefone 2"],
  },
  {
    key: "email",
    label: "E-mail",
    example: "maria@exemplo.com.br",
    aliases: ["email", "e mail", "correio eletronico", "endereco de email"],
  },
  {
    key: "document",
    label: "CPF ou CNPJ",
    example: "529.982.247-25",
    aliases: ["cpf", "cnpj", "cpf cnpj", "cpf ou cnpj", "documento", "cpf/cnpj"],
  },
  {
    key: "kind",
    label: "Tipo de pessoa",
    hint: "PF ou PJ. Sem a coluna, o CRM decide pelo documento.",
    example: "PF",
    aliases: ["tipo de pessoa", "pessoa", "pf pj", "tipo pessoa"],
  },
  {
    key: "trade_name",
    label: "Nome fantasia",
    example: "",
    aliases: ["nome fantasia", "fantasia"],
  },
  { key: "rg", label: "RG", example: "12.345.678-9", aliases: ["rg", "identidade"] },
  {
    key: "birth_date",
    label: "Data de nascimento",
    hint: "DD/MM/AAAA.",
    example: "15/03/1985",
    aliases: ["data de nascimento", "nascimento", "aniversario", "data nascimento"],
  },
  {
    key: "postal_code",
    label: "CEP",
    example: "01310-100",
    aliases: ["cep", "codigo postal"],
  },
  {
    key: "street",
    label: "Rua",
    example: "Avenida Paulista",
    aliases: ["rua", "endereco", "logradouro", "avenida"],
  },
  {
    key: "street_number",
    label: "Número",
    example: "1000",
    aliases: ["numero", "n", "no", "nro", "num"],
  },
  {
    key: "complement",
    label: "Complemento",
    example: "Apto 12",
    aliases: ["complemento", "compl"],
  },
  { key: "neighborhood", label: "Bairro", example: "Bela Vista", aliases: ["bairro"] },
  { key: "city", label: "Cidade", example: "São Paulo", aliases: ["cidade", "municipio"] },
  {
    key: "state",
    label: "UF",
    hint: "Sigla ou nome do estado.",
    example: "SP",
    aliases: ["uf", "estado"],
  },
  {
    key: "source",
    label: "Origem",
    hint: "Site, portal, indicação, placa, redes sociais ou outro.",
    example: "Indicação",
    aliases: ["origem", "fonte", "canal", "como conheceu", "midia"],
  },
  {
    key: "tags",
    label: "Etiquetas",
    hint: "Separe por vírgula.",
    example: "comprador, alto padrão",
    aliases: ["etiquetas", "tags", "etiqueta", "tag", "marcadores", "grupo"],
  },
  {
    key: "assigned_to",
    label: "Corretor responsável",
    hint: "E-mail ou nome de alguém da equipe.",
    example: "corretor@suaimobiliaria.com.br",
    aliases: ["corretor responsavel", "responsavel", "corretor", "atendente", "vendedor"],
  },
  {
    key: "notes",
    label: "Observações",
    example: "Procura apartamento de 2 quartos.",
    aliases: ["observacoes", "observacao", "obs", "anotacoes", "notas", "comentarios"],
  },
]

export const LEAD_IMPORT_FIELDS: readonly ImportField[] = [
  {
    key: "name",
    label: "Nome",
    hint: "Obrigatório.",
    example: "João Pereira",
    aliases: ["nome", "nome completo", "lead", "cliente", "interessado"],
  },
  {
    key: "phone",
    label: "Telefone",
    hint: "Com DDD. Telefone ou e-mail: pelo menos um.",
    example: "(21) 99876-5432",
    aliases: ["telefone", "fone", "tel", "celular", "whatsapp", "whats"],
  },
  {
    key: "email",
    label: "E-mail",
    example: "joao@exemplo.com",
    aliases: ["email", "e mail", "correio eletronico"],
  },
  {
    key: "stage",
    label: "Etapa",
    hint: "Novo, em contato, qualificado, visita agendada, proposta, ganho ou perdido.",
    example: "Em contato",
    aliases: ["etapa", "status", "fase", "situacao", "estagio"],
  },
  {
    key: "lost_reason",
    label: "Motivo da perda",
    example: "",
    aliases: ["motivo da perda", "motivo", "motivo perda"],
  },
  {
    key: "interest",
    label: "Interesse",
    hint: "Comprar, alugar, investir, vender ou informações.",
    example: "Comprar",
    aliases: ["interesse", "objetivo", "pretensao"],
  },
  {
    key: "source",
    label: "Origem",
    hint: "Portal, site, redes sociais, indicação ou outro.",
    example: "Portal",
    aliases: ["origem", "fonte", "canal", "midia"],
  },
  {
    key: "typology",
    label: "Tipologia",
    hint: "Ex.: 2 quartos, cobertura.",
    example: "2 quartos",
    aliases: ["tipologia", "imovel de interesse", "tipo de imovel"],
  },
  {
    key: "message",
    label: "Mensagem",
    hint: "Até 2.000 caracteres.",
    example: "Quer visitar no sábado.",
    aliases: ["mensagem", "observacoes", "observacao", "obs", "comentarios", "anotacoes"],
  },
  {
    key: "assigned_to",
    label: "Corretor responsável",
    hint: "E-mail ou nome de alguém da equipe.",
    example: "corretor@suaimobiliaria.com.br",
    aliases: ["corretor responsavel", "responsavel", "corretor", "atendente", "vendedor"],
  },
  {
    key: "received_at",
    label: "Data de entrada",
    hint: "Quando o lead chegou (DD/MM/AAAA, com hora opcional). Sem ela, o lead não entra nos relatórios de período.",
    example: "10/03/2025 09:15",
    aliases: [
      "data de entrada",
      "entrada",
      "data do lead",
      "data de cadastro",
      "cadastrado em",
      "criado em",
      "data de criacao",
      "recebido em",
    ],
  },
  {
    key: "first_contact_at",
    label: "Data do 1º contato",
    hint: "DD/MM/AAAA, com hora opcional.",
    example: "10/03/2025 10:40",
    aliases: [
      "data do 1 contato",
      "data do primeiro contato",
      "primeiro contato",
      "1 contato",
      "data 1 contato",
      "atendido em",
    ],
  },
  {
    key: "closed_at",
    label: "Data de ganho ou perda",
    hint: "Para leads ganhos ou perdidos. DD/MM/AAAA.",
    example: "",
    aliases: [
      "data de ganho ou perda",
      "data de ganho",
      "data de perda",
      "data de fechamento",
      "fechado em",
      "data de conclusao",
    ],
  },
]

export const PROPERTY_IMPORT_FIELDS: readonly ImportField[] = [
  {
    key: "external_code",
    label: "Código de referência",
    hint: "Código do sistema anterior. Evita duplicar ao reimportar.",
    example: "AP0123",
    aliases: ["codigo de referencia", "codigo", "referencia", "ref", "cod", "codigo do imovel"],
  },
  {
    key: "type",
    label: "Tipo",
    hint: "Obrigatório. Apartamento, casa, terreno, sala comercial…",
    example: "Apartamento",
    aliases: ["tipo", "tipo do imovel", "tipo de imovel", "categoria"],
  },
  {
    key: "purpose",
    label: "Finalidade",
    hint: "Venda, locação ou venda e locação. Sem a coluna, vem dos preços.",
    example: "Venda",
    aliases: ["finalidade", "negocio", "transacao", "operacao", "tipo de negocio"],
  },
  {
    key: "title",
    label: "Título",
    hint: "Sem título, o CRM monta um (ex.: Apartamento em Moema).",
    example: "Apartamento com varanda em Moema",
    aliases: ["titulo", "titulo do anuncio", "nome do imovel", "chamada"],
  },
  {
    key: "description",
    label: "Descrição",
    example: "Apartamento reformado, perto do metrô.",
    aliases: ["descricao", "descricao do imovel", "detalhes", "observacoes", "texto do anuncio"],
  },
  {
    key: "status",
    label: "Situação",
    hint: "Ativo, rascunho, reservado, vendido, alugado ou inativo.",
    example: "Ativo",
    aliases: ["situacao", "status", "disponibilidade"],
  },
  {
    key: "usage",
    label: "Uso",
    hint: "Residencial, comercial, rural ou industrial.",
    example: "Residencial",
    aliases: ["uso", "destinacao"],
  },
  {
    key: "sale_price",
    label: "Preço de venda",
    example: "850.000,00",
    aliases: ["preco de venda", "valor de venda", "preco venda", "valor venda", "preco"],
  },
  {
    key: "rent_price",
    label: "Aluguel",
    example: "",
    aliases: [
      "aluguel",
      "valor do aluguel",
      "preco de locacao",
      "valor de locacao",
      "valor locacao",
    ],
  },
  {
    key: "condo_fee",
    label: "Condomínio",
    example: "780,00",
    aliases: ["condominio", "valor do condominio", "taxa de condominio"],
  },
  {
    key: "iptu_yearly",
    label: "IPTU anual",
    example: "2.400,00",
    aliases: ["iptu", "iptu anual", "valor do iptu"],
  },
  {
    key: "living_area",
    label: "Área útil (m²)",
    example: "72",
    aliases: ["area util", "area", "area construida", "area privativa", "metragem", "m2"],
  },
  {
    key: "lot_area",
    label: "Área do terreno (m²)",
    example: "",
    aliases: ["area do terreno", "area total", "terreno", "area do lote", "lote"],
  },
  {
    key: "bedrooms",
    label: "Quartos",
    example: "2",
    aliases: ["quartos", "dormitorios", "dorms", "qtos", "dormitorio"],
  },
  { key: "suites", label: "Suítes", example: "1", aliases: ["suites", "suite"] },
  {
    key: "bathrooms",
    label: "Banheiros",
    example: "2",
    aliases: ["banheiros", "banheiro", "wc", "banhos"],
  },
  {
    key: "parking_spaces",
    label: "Vagas",
    example: "1",
    aliases: ["vagas", "vaga", "garagem", "vagas de garagem"],
  },
  { key: "floor", label: "Andar", example: "8", aliases: ["andar", "pavimento"] },
  {
    key: "total_floors",
    label: "Total de andares",
    example: "15",
    aliases: ["total de andares", "andares", "pavimentos"],
  },
  {
    key: "year_built",
    label: "Ano de construção",
    example: "2012",
    aliases: ["ano de construcao", "ano", "ano construcao"],
  },
  {
    key: "features",
    label: "Características",
    hint: "Separe por vírgula. Ex.: piscina, churrasqueira.",
    example: "Piscina, Churrasqueira, Varanda",
    aliases: ["caracteristicas", "comodidades", "diferenciais", "itens", "infraestrutura"],
  },
  {
    key: "furnished",
    label: "Mobiliado",
    hint: "Sim ou não.",
    example: "Não",
    aliases: ["mobiliado", "mobilia"],
  },
  {
    key: "accepts_pets",
    label: "Aceita pet",
    hint: "Sim ou não.",
    example: "Sim",
    aliases: ["aceita pet", "aceita pets", "aceita animais", "pet"],
  },
  {
    key: "accepts_exchange",
    label: "Aceita permuta",
    hint: "Sim ou não.",
    example: "Não",
    aliases: ["aceita permuta", "permuta"],
  },
  { key: "postal_code", label: "CEP", example: "04521-000", aliases: ["cep"] },
  {
    key: "street",
    label: "Rua",
    example: "Rua Gaivota",
    aliases: ["rua", "endereco", "logradouro"],
  },
  {
    key: "street_number",
    label: "Número",
    example: "120",
    aliases: ["numero", "n", "no", "nro", "num"],
  },
  { key: "complement", label: "Complemento", example: "Apto 82", aliases: ["complemento"] },
  { key: "neighborhood", label: "Bairro", example: "Moema", aliases: ["bairro"] },
  { key: "city", label: "Cidade", example: "São Paulo", aliases: ["cidade", "municipio"] },
  { key: "state", label: "UF", example: "SP", aliases: ["uf", "estado"] },
  {
    key: "broker_id",
    label: "Corretor responsável",
    hint: "E-mail ou nome de alguém da equipe.",
    example: "",
    aliases: ["corretor responsavel", "corretor", "responsavel"],
  },
  {
    key: "captured_by",
    label: "Captador",
    hint: "E-mail ou nome de alguém da equipe.",
    example: "",
    aliases: ["captador", "angariador", "captacao"],
  },
  {
    key: "owner_name",
    label: "Proprietário",
    hint: "Nome. Mais de um: separe por | (ex.: Maria | João), na mesma ordem nas outras colunas do proprietário.",
    example: "Maria da Silva",
    aliases: ["proprietario", "nome do proprietario", "proprietarios", "dono", "locador"],
  },
  {
    key: "owner_document",
    label: "CPF/CNPJ do proprietário",
    example: "529.982.247-25",
    aliases: [
      "cpf cnpj do proprietario",
      "cpf do proprietario",
      "cnpj do proprietario",
      "documento do proprietario",
    ],
  },
  {
    key: "owner_phone",
    label: "Telefone do proprietário",
    hint: "Com DDD. Proprietário precisa de CPF/CNPJ, telefone ou e-mail.",
    example: "(11) 98765-4321",
    aliases: ["telefone do proprietario", "celular do proprietario", "fone do proprietario"],
  },
  {
    key: "owner_email",
    label: "E-mail do proprietário",
    example: "maria@exemplo.com.br",
    aliases: ["email do proprietario", "e mail do proprietario"],
  },
  {
    key: "owner_share",
    label: "Percentual do proprietário",
    hint: "Opcional. Com mais de um proprietário, informe todos (ex.: 60 | 40), somando 100.",
    example: "100",
    aliases: [
      "percentual do proprietario",
      "percentual",
      "participacao",
      "porcentagem do proprietario",
    ],
  },
  {
    key: "photo_urls",
    label: "Links das fotos",
    hint: "Até 20 links por imóvel, separados por | (a primeira vira capa). Baixamos e otimizamos no servidor.",
    example: "https://exemplo.com/foto1.jpg | https://exemplo.com/foto2.jpg",
    aliases: [
      "links das fotos",
      "fotos",
      "foto",
      "imagens",
      "url das fotos",
      "urls das fotos",
      "link das fotos",
    ],
  },
]

export const IMPORT_FIELDS: Record<ImportKind, readonly ImportField[]> = {
  clients: CLIENT_IMPORT_FIELDS,
  leads: LEAD_IMPORT_FIELDS,
  properties: PROPERTY_IMPORT_FIELDS,
}

export function getImportField(kind: ImportKind, key: string): ImportField | undefined {
  return IMPORT_FIELDS[kind].find((field) => field.key === key)
}

export function getImportFieldLabel(kind: ImportKind, key: string): string {
  return getImportField(kind, key)?.label ?? key
}

/**
 * O que precisa estar mapeado para seguir. Cada grupo é "pelo menos um destes".
 * Ex.: clientes precisam de Nome e de algum contato.
 */
export const IMPORT_REQUIRED_GROUPS: Record<ImportKind, readonly (readonly string[])[]> = {
  clients: [["name"], ["phone", "whatsapp", "email", "document"]],
  leads: [["name"], ["phone", "email"]],
  properties: [["type"], ["purpose", "sale_price", "rent_price"]],
}

/** Aliases já normalizados, calculados uma vez. */
const NORMALIZED_ALIASES = new Map<ImportKind, Map<string, readonly string[]>>(
  IMPORT_KINDS.map((kind) => [
    kind,
    new Map(
      IMPORT_FIELDS[kind].map((field) => [
        field.key,
        [normalizeLabel(field.label), ...field.aliases.map(normalizeLabel)],
      ])
    ),
  ])
)

export function getNormalizedAliases(kind: ImportKind, key: string): readonly string[] {
  return NORMALIZED_ALIASES.get(kind)?.get(key) ?? []
}
