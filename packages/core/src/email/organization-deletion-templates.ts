// E-mails da exclusão da imobiliária: aviso no agendamento e 3 dias antes.
// Mesmo layout dos demais avisos; todo texto recebido é tratado como dado não
// confiável (limpo e escapado em renderEmail).

import { renderEmail, type EmailBrand, type RenderedEmail } from "./layout"
import { cleanText, formatEmailDate } from "./sanitize"
import { EmailTemplateError, greetingFor, requireLink, requireOrigin } from "./templates"

export const ORGANIZATION_DELETION_NOTICE_KINDS = ["scheduled", "reminder"] as const

export type OrganizationDeletionNoticeKind = (typeof ORGANIZATION_DELETION_NOTICE_KINDS)[number]

/** Onde o dono cancela a exclusão (Configurações > Imobiliária). */
export const ORGANIZATION_DELETION_SETTINGS_PATH = "/configuracoes/imobiliaria#excluir-imobiliaria"

export type OrganizationDeletionEmailParams = {
  /** Origem da imobiliária (subdomínio ou host único), ex.: https://imob.seucrm.com.br */
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  kind: OrganizationDeletionNoticeKind
  organizationName: string
  /** Quando os dados serão apagados. */
  executeAfter: Date | string
}

export function organizationDeletionEmail(params: OrganizationDeletionEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink(ORGANIZATION_DELETION_SETTINGS_PATH, origin)
  const date = formatEmailDate(params.executeAfter)

  if (!date) {
    throw new EmailTemplateError("Data da exclusão inválida para o e-mail.")
  }

  const organization = cleanText(params.organizationName, { maxLength: 80 }) || "sua imobiliária"
  const common = {
    greeting: greetingFor(params.recipientName),
    footer: `Você recebeu este e-mail porque é dono de ${organization} no CRM.`,
    details: [
      { label: "Imobiliária", value: organization },
      { label: "Exclusão definitiva", value: date },
    ],
    action: { label: "Cancelar a exclusão", url },
    closing: [
      "Antes da data, exporte o que precisar guardar (clientes, leads, imóveis e relatórios em planilha). Depois dela, nada pode ser recuperado.",
      "Se você não pediu esta exclusão, cancele agora e troque a sua senha.",
    ],
  }

  if (params.kind === "reminder") {
    return renderEmail(params.brand, {
      ...common,
      subject: `Faltam 3 dias: ${organization} será apagada em ${date}`,
      preheader: "Última chance de exportar os dados ou cancelar a exclusão.",
      heading: "A exclusão da imobiliária está chegando",
      paragraphs: [
        `Em ${date}, todos os dados de ${organization} serão apagados de vez: clientes, leads, imóveis, fotos, documentos, propostas, agenda e a equipe.`,
        "Até lá a conta continua em modo leitura: dá para ver e exportar tudo, mas não criar nem editar.",
      ],
      highlight: `Exclusão definitiva em ${date}.`,
    })
  }

  return renderEmail(params.brand, {
    ...common,
    subject: `Exclusão de ${organization} agendada para ${date}`,
    preheader: "A conta ficou em modo leitura. Você pode cancelar até a data.",
    heading: "Exclusão da imobiliária agendada",
    paragraphs: [
      `A exclusão de ${organization} foi agendada. Em ${date}, todos os dados serão apagados de vez: clientes, leads, imóveis, fotos, documentos, propostas, agenda e a equipe.`,
      "Até lá a conta fica em modo leitura: dá para ver e exportar tudo, mas não criar nem editar. Enviaremos outro aviso 3 dias antes.",
    ],
    highlight: `Você pode cancelar até ${date}.`,
  })
}
