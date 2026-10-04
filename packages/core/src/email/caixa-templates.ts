// Modelo do lembrete de envio da lista da Caixa (pt-BR), para a equipe da
// plataforma. Mesmas garantias de templates.ts: todo dado é não confiável (limpo
// e escapado em layout.ts) e os links ficam presos à origem ou ao https oficial.

import { formatBrDate } from "../caixa/normalize"
import { CAIXA_DOWNLOAD_PAGE_URL } from "../caixa/source"
import { CAIXA_UPLOAD_PAGE_PATH } from "../caixa/upload-reminder"
import { renderEmail, type RenderedEmail } from "./layout"
import { formatEmailDateTime } from "./sanitize"
import { requireLink, requireOrigin } from "./templates"

const numberFormat = new Intl.NumberFormat("pt-BR")

export type CaixaUploadReminderEmailParams = {
  /** Origem do domínio raiz (ou do host único) da plataforma. */
  origin: string
  /** `caixa_catalog_status.sincronizado_em`: quando a última carga terminou. */
  syncedAt: string | Date
  /** `caixa_catalog_status.lista_gerada_em`: data declarada pela Caixa no arquivo (ISO). */
  generatedOn: string | null
  /** Imóveis ativos no catálogo. */
  totalActive: number | null
  /** Horas desde a última carga. */
  ageHours: number
}

function ageLabel(hours: number) {
  if (!Number.isFinite(hours) || hours < 48) {
    return "mais de 24 horas"
  }

  const days = Math.floor(hours / 24)
  return `${numberFormat.format(days)} dias`
}

/** Lembrete diário: a última carga do catálogo da Caixa tem mais de 24 horas. */
export function caixaUploadReminderEmail(params: CaixaUploadReminderEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const uploadUrl = requireLink(CAIXA_UPLOAD_PAGE_PATH, origin)
  const downloadUrl = requireLink(CAIXA_DOWNLOAD_PAGE_URL, origin)
  const listDate = formatBrDate(params.generatedOn)
  const syncedAt = formatEmailDateTime(params.syncedAt)
  const age = ageLabel(params.ageHours)
  const total =
    typeof params.totalActive === "number" && Number.isFinite(params.totalActive)
      ? numberFormat.format(Math.max(0, Math.floor(params.totalActive)))
      : null

  return renderEmail(null, {
    subject: listDate
      ? `Atualize a lista da Caixa (a atual é de ${listDate})`
      : "Atualize a lista de imóveis da Caixa",
    preheader: `A última carga tem ${age}. Baixe a lista oficial e envie na plataforma.`,
    heading: "Hora de atualizar a lista da Caixa",
    greeting: "Olá!",
    paragraphs: [
      `O catálogo de imóveis da Caixa que as imobiliárias veem no CRM foi carregado há ${age}.`,
      'Leva dois minutos: na página oficial da Caixa, escolha a lista geral ("Todos os estados"), baixe o arquivo .csv e envie na página da plataforma, sem abrir o arquivo antes.',
    ],
    details: [
      { label: "Lista da Caixa de", value: listDate },
      { label: "Carregada em", value: syncedAt },
      { label: "Imóveis ativos", value: total },
    ],
    action: { label: "Abrir a página de envio", url: uploadUrl },
    secondaryActions: [{ label: "Página oficial de download da Caixa", url: downloadUrl }],
    footer:
      "Você recebeu este e-mail porque seu endereço está na lista da equipe da plataforma (PLATFORM_ADMIN_EMAILS). O lembrete sai uma vez por dia enquanto a última carga tiver mais de 24 horas.",
  })
}
