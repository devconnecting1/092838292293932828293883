import {
  INCIDENT_STATUS_LABELS,
  type PublicIncident,
  type PublicStatusSnapshot,
} from "@workspace/core/status/public"

import { APP_NAME } from "@/components/crm/brand"
import { incidentAnchorId, listComponentNames, parseStatusDate } from "@/components/status/format"
import { STATUS_FEED_PATH, STATUS_PAGE_PATH, tryBuildStatusUrl } from "@/components/status/links"
import { getPublicStatus } from "@/lib/status/public"

// Em cache por 5 minutos (leitores de RSS consultam de tempos em tempos): não
// vira uma invocação por leitura.
export const revalidate = 300

/**
 * O XML 1.0 não aceita caracteres de controle (exceto tab e quebras de linha),
 * surrogates soltos nem U+FFFE/U+FFFF: saem antes de escapar o texto.
 */
function isXmlChar(char: string) {
  const code = char.codePointAt(0) ?? 0

  if (code === 0x9 || code === 0xa || code === 0xd) {
    return true
  }

  return code >= 0x20 && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff
}

function escapeXml(value: string) {
  return Array.from(value)
    .filter(isXmlChar)
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function toRfc822(value: string) {
  return parseStatusDate(value)?.toUTCString() ?? null
}

function describeIncident(incident: PublicIncident) {
  const lines = [`Situação: ${INCIDENT_STATUS_LABELS[incident.status]}.`]
  const affected = listComponentNames(incident.componentKeys)

  if (affected) {
    lines.push(`Afeta: ${affected}.`)
  }

  for (const update of incident.updates) {
    lines.push(`${INCIDENT_STATUS_LABELS[update.status]}: ${update.message}`)
  }

  return lines.join("\n")
}

function buildItem(incident: PublicIncident, pageUrl: string) {
  const latest = incident.updates[0]?.createdAt ?? incident.resolvedAt ?? incident.startedAt
  const pubDate = toRfc822(latest)
  const prefix = incident.kind === "maintenance" ? "Manutenção" : "Incidente"
  const link = `${pageUrl}#${incidentAnchorId(incident.id)}`

  return [
    "<item>",
    `<title>${escapeXml(`${prefix}: ${incident.title} (${INCIDENT_STATUS_LABELS[incident.status]})`)}</title>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="false">${escapeXml(`status-${incident.id}`)}</guid>`,
    pubDate ? `<pubDate>${pubDate}</pubDate>` : "",
    `<description>${escapeXml(describeIncident(incident))}</description>`,
    "</item>",
  ].join("")
}

function buildFeed(snapshot: PublicStatusSnapshot | null) {
  const pageUrl = tryBuildStatusUrl(STATUS_PAGE_PATH) ?? STATUS_PAGE_PATH
  const feedUrl = tryBuildStatusUrl(STATUS_FEED_PATH)
  const incidents = snapshot
    ? [...snapshot.activeIncidents, ...snapshot.upcomingMaintenances, ...snapshot.pastIncidents]
    : []
  const unique = new Map(incidents.map((incident) => [incident.id, incident]))
  const items = [...unique.values()].map((incident) => buildItem(incident, pageUrl))
  const lastBuild = snapshot ? toRfc822(snapshot.generatedAt) : null

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(`Status do sistema · ${APP_NAME}`)}</title>`,
    `<link>${escapeXml(pageUrl)}</link>`,
    `<description>${escapeXml(`Incidentes e manutenções do ${APP_NAME} (últimos 14 dias).`)}</description>`,
    "<language>pt-BR</language>",
    feedUrl
      ? `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`
      : "",
    lastBuild ? `<lastBuildDate>${lastBuild}</lastBuildDate>` : "",
    "<ttl>5</ttl>",
    ...items,
    "</channel>",
    "</rss>",
  ].join("\n")
}

/** Feed RSS público dos incidentes e manutenções (mesmos dados de /status). */
export async function GET() {
  let snapshot: PublicStatusSnapshot | null = null

  try {
    snapshot = await getPublicStatus()
  } catch (cause) {
    console.error(
      `[status] feed sem retrato público (${cause instanceof Error ? cause.name : "erro"})`
    )
  }

  return new Response(buildFeed(snapshot), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  })
}
