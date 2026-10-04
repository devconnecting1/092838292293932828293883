// Aviso aos Donos da plataforma sobre incidente automático da página de status
// (pt-BR). Mesmas garantias de templates.ts: todo dado é não confiável (limpo e
// escapado em layout.ts) e os links ficam presos à origem recebida. Nada de
// detalhe interno: só o que o público também vê, mais o link do Console.

import { isStatusAlertKind, type StatusAlertKind } from "../status/automation"
import { isIncidentImpact, isStatusComponentKey } from "../status/levels"
import { INCIDENT_IMPACT_LABELS, STATUS_COMPONENTS, type IncidentImpact } from "../status/public"
import { renderEmail, type RenderedEmail } from "./layout"
import { cleanText, formatEmailDateTime } from "./sanitize"
import { EmailTemplateError, requireLink, requireOrigin } from "./templates"

/** Caminho do Console onde a equipe assume ou acompanha o incidente. */
export const STATUS_ALERT_CONSOLE_PATH = "/plataforma/status"

/** Página pública de status. */
export const STATUS_ALERT_PUBLIC_PATH = "/status"

export type StatusAutoIncidentAlertEmailParams = {
  /** Origem do domínio raiz (ou do host único) da plataforma. */
  origin: string
  kind: StatusAlertKind
  /** Título do incidente (o mesmo que o público vê). */
  title: string
  impact: IncidentImpact
  componentKeys: readonly string[]
  startedAt: string | Date
  resolvedAt?: string | Date | null
}

function componentNames(keys: readonly string[]): string | null {
  const chosen = new Set(keys.filter(isStatusComponentKey))
  const names = STATUS_COMPONENTS.filter((component) => chosen.has(component.key)).map(
    (component) => component.name
  )

  return names.length > 0 ? names.join(", ") : null
}

/** Incidente automático chegou a impacto grande/crítico ou resolveu sozinho. */
export function statusAutoIncidentAlertEmail(
  params: StatusAutoIncidentAlertEmailParams
): RenderedEmail {
  const origin = requireOrigin(params.origin)

  if (!isStatusAlertKind(params.kind)) {
    throw new EmailTemplateError("Tipo de aviso de status inválido.")
  }

  if (!isIncidentImpact(params.impact)) {
    throw new EmailTemplateError("Impacto do incidente inválido.")
  }

  const title = cleanText(params.title, { maxLength: 120 })

  if (!title) {
    throw new EmailTemplateError("Título do incidente vazio.")
  }

  const consoleUrl = requireLink(STATUS_ALERT_CONSOLE_PATH, origin)
  const publicUrl = requireLink(STATUS_ALERT_PUBLIC_PATH, origin)
  const parts = componentNames(params.componentKeys)
  const impact = INCIDENT_IMPACT_LABELS[params.impact]
  const startedAt = formatEmailDateTime(params.startedAt)
  const resolvedAt = formatEmailDateTime(params.resolvedAt)
  const footer =
    "Você recebeu este aviso porque seu endereço está na lista de Donos da plataforma (PLATFORM_ADMIN_EMAILS). Sai só quando um incidente automático chega a impacto grande ou crítico e quando ele se resolve sozinho, com no máximo 10 e-mails por dia no total."

  if (params.kind === "opened") {
    return renderEmail(null, {
      subject: `Incidente automático: ${title}`,
      preheader: `${impact}. A página de status já mostra o incidente para os clientes.`,
      heading: "A página de status abriu um incidente sozinha",
      greeting: "Olá!",
      paragraphs: [
        "A medição automática viu uma parte do sistema fora do normal por vários minutos seguidos e publicou um incidente na página de status, com texto de modelo.",
        "A automação atualiza e resolve o incidente sozinha. Se quiser escrever para os clientes, abra o Console e clique em Assumir (ou publique uma atualização): daí em diante a automação não mexe mais nele.",
      ],
      highlight: parts ? `Afeta: ${parts}` : null,
      details: [
        { label: "Incidente", value: title },
        { label: "Impacto", value: impact },
        { label: "Partes", value: parts },
        { label: "Desde", value: startedAt },
      ],
      action: { label: "Abrir o status no Console", url: consoleUrl },
      secondaryActions: [{ label: "Ver a página pública", url: publicUrl }],
      footer,
    })
  }

  return renderEmail(null, {
    subject: `Resolvido: ${title}`,
    preheader: "A medição automática confirmou que o funcionamento voltou ao normal.",
    heading: "Incidente automático resolvido",
    greeting: "Olá!",
    paragraphs: [
      "O funcionamento ficou normal por tempo suficiente e a automação marcou o incidente como resolvido na página de status.",
      "Se a instabilidade voltar em até 30 minutos, o mesmo incidente é reaberto.",
    ],
    details: [
      { label: "Incidente", value: title },
      { label: "Impacto", value: impact },
      { label: "Partes", value: parts },
      { label: "Começou", value: startedAt },
      { label: "Resolvido", value: resolvedAt },
    ],
    action: { label: "Abrir o status no Console", url: consoleUrl },
    secondaryActions: [{ label: "Ver a página pública", url: publicUrl }],
    footer,
  })
}
