// Consentimento com prova (LGPD).
//
// Por que um booleano `consentimento = true` com data não basta:
//
//   - Art. 8º, § 2º: "Cabe ao controlador o ônus da prova de que o
//     consentimento foi obtido em conformidade com o disposto nesta Lei."
//   - Art. 8º, § 4º: "O consentimento deverá referir-se a finalidades
//     determinadas, e as autorizações genéricas para o tratamento de dados
//     pessoais serão nulas."
//   - Art. 9º, § 1º: se a informação dada ao titular tiver conteúdo enganoso ou
//     abusivo, ou não tiver sido apresentada previamente com transparência,
//     "clara e inequívoca", o consentimento será nulo.
//
// Tradução para o schema: a finalidade é granular (este enum, nunca um
// booleano), e o registro guarda o TEXTO EXATO exibido ao titular, a versão da
// política, o canal, a origem da coleta e o momento. Revogar não apaga nada —
// grava um novo evento. A tabela `public.consent_records` é append-only.
//
// Espelho no banco: enums `public.consent_purpose`, `public.consent_channel`,
// `public.consent_source` e `public.consent_action`, na migração
// `consent_records`.

/**
 * Finalidades. Uma linha de consentimento vale para UMA finalidade em UM canal.
 * Nunca some finalidades num único registro: autorização genérica é nula.
 */
export const CONSENT_PURPOSES = [
  "atendimento",
  "envio_de_imoveis",
  "divulgacao",
  "pesquisa_satisfacao",
  "compartilhamento_parceiros",
] as const

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return (
    typeof value === "string" &&
    (CONSENT_PURPOSES as readonly string[]).includes(value as ConsentPurpose)
  )
}

export type ConsentPurposeDefinition = {
  key: ConsentPurpose
  label: string
  /** O que o titular está autorizando, em português de gente. */
  description: string
  /**
   * `true` quando a finalidade NÃO se sustenta sem consentimento — é o caso de
   * tudo que é divulgação. As finalidades de atendimento costumam ter outra
   * base legal (execução de contrato / procedimento preliminar, art. 7º, V),
   * mas o registro é feito do mesmo jeito: a prova vale para as duas.
   */
  requiresConsent: boolean
  /** Base legal declarada quando `requiresConsent` é falso. */
  alternativeLegalBasis: string | null
}

export const CONSENT_PURPOSE_DEFINITIONS: Record<ConsentPurpose, ConsentPurposeDefinition> = {
  atendimento: {
    key: "atendimento",
    label: "Atendimento",
    description: "Responder a esta solicitação e dar andamento à negociação do imóvel.",
    requiresConsent: false,
    alternativeLegalBasis:
      "Procedimento preliminar a contrato, a pedido do titular (LGPD, art. 7º, V).",
  },
  envio_de_imoveis: {
    key: "envio_de_imoveis",
    label: "Envio de imóveis compatíveis",
    description: "Receber sugestões de imóveis parecidos com o que procuro.",
    requiresConsent: true,
    alternativeLegalBasis: null,
  },
  divulgacao: {
    key: "divulgacao",
    label: "Ofertas e avisos",
    description: "Receber ofertas, lançamentos e campanhas da imobiliária.",
    requiresConsent: true,
    alternativeLegalBasis: null,
  },
  pesquisa_satisfacao: {
    key: "pesquisa_satisfacao",
    label: "Pesquisa de satisfação",
    description: "Responder pesquisas sobre o atendimento recebido.",
    requiresConsent: true,
    alternativeLegalBasis: null,
  },
  compartilhamento_parceiros: {
    key: "compartilhamento_parceiros",
    label: "Compartilhamento com parceiros",
    description:
      "Ter meus dados compartilhados com construtoras, incorporadoras ou bancos parceiros indicados pela imobiliária.",
    requiresConsent: true,
    alternativeLegalBasis: null,
  },
}

/** Finalidades que só podem ser exercidas com consentimento vigente. */
export const CONSENT_MARKETING_PURPOSES: readonly ConsentPurpose[] = CONSENT_PURPOSES.filter(
  (purpose) => CONSENT_PURPOSE_DEFINITIONS[purpose].requiresConsent
)

export const CONSENT_CHANNELS = ["whatsapp", "email", "sms", "telefone", "presencial"] as const

export type ConsentChannel = (typeof CONSENT_CHANNELS)[number]

export function isConsentChannel(value: unknown): value is ConsentChannel {
  return (
    typeof value === "string" &&
    (CONSENT_CHANNELS as readonly string[]).includes(value as ConsentChannel)
  )
}

export const CONSENT_CHANNEL_LABELS: Record<ConsentChannel, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  sms: "SMS",
  telefone: "Telefone",
  presencial: "Presencial",
}

/**
 * Onde o consentimento foi coletado. `importacao` existe para ser honesto: uma
 * planilha importada NÃO traz consentimento, e o padrão do produto é registrar
 * a importação como "sem consentimento" até que alguém prove o contrário.
 */
export const CONSENT_SOURCES = [
  "formulario_site",
  "landing_page",
  "captacao_publica",
  "whatsapp_opt_in",
  "portal",
  "indicacao",
  "atendimento_presencial",
  "telefone",
  "contrato",
  "importacao",
] as const

export type ConsentSource = (typeof CONSENT_SOURCES)[number]

export function isConsentSource(value: unknown): value is ConsentSource {
  return (
    typeof value === "string" &&
    (CONSENT_SOURCES as readonly string[]).includes(value as ConsentSource)
  )
}

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  formulario_site: "Formulário do site",
  landing_page: "Landing page",
  captacao_publica: "Formulário público de captação",
  whatsapp_opt_in: "Autorização no próprio WhatsApp",
  portal: "Portal de anúncios",
  indicacao: "Indicação",
  atendimento_presencial: "Atendimento presencial",
  telefone: "Telefone",
  contrato: "Contrato assinado",
  importacao: "Importação de planilha",
}

/**
 * Origens que, sozinhas, NUNCA constituem consentimento para divulgação.
 * O banco recusa gravar `granted` para finalidade de marketing vinda daqui.
 */
export const CONSENT_SOURCES_WITHOUT_PROOF: readonly ConsentSource[] = [
  "importacao",
  "portal",
  "indicacao",
]

export const CONSENT_ACTIONS = ["granted", "revoked"] as const

export type ConsentAction = (typeof CONSENT_ACTIONS)[number]

export function isConsentAction(value: unknown): value is ConsentAction {
  return (
    typeof value === "string" &&
    (CONSENT_ACTIONS as readonly string[]).includes(value as ConsentAction)
  )
}

export const CONSENT_ACTION_LABELS: Record<ConsentAction, string> = {
  granted: "Autorizou",
  revoked: "Revogou",
}

/**
 * Versão do texto informativo padrão da plataforma. Mudou o texto? sobe a
 * versão — é ela que amarra o registro ao que a pessoa leu de fato.
 */
export const CONSENT_POLICY_VERSION = "2026-09-16"

/** Tamanho máximo do texto exibido que guardamos por registro. */
export const CONSENT_DISCLOSURE_MAX_LENGTH = 4000

/**
 * Texto padrão exibido ao titular. É sugestão da plataforma: a imobiliária é a
 * controladora e pode usar o texto dela — o que o produto exige é que ALGUM
 * texto tenha sido exibido e que seja ele o gravado.
 */
export function defaultDisclosureText(
  purpose: ConsentPurpose,
  channel: ConsentChannel,
  organizationName: string
): string {
  const definition = CONSENT_PURPOSE_DEFINITIONS[purpose]

  return [
    `${organizationName} quer usar meus dados para: ${definition.description}`,
    `Canal: ${CONSENT_CHANNEL_LABELS[channel]}.`,
    "Posso revogar esta autorização a qualquer momento, sem custo, pelo mesmo canal ou pelos contatos da política de privacidade.",
  ].join(" ")
}
