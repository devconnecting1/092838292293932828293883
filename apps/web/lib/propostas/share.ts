import "server-only"

import { lookup } from "node:dns/promises"

// Entrega da proposta ao cliente: leitura do documento (equipe e link público),
// registro da abertura e download do logo da imobiliária para o PDF.
//
// O link público não usa sessão: quem decide o acesso é a RPC
// get_shared_proposal (security definer), que devolve null para token errado,
// revogado ou vencido, sem distinguir os casos — mesmo desenho do feed dos
// portais.

import { cache } from "react"

import { isProposalShareToken } from "@workspace/core/proposals/share"

import { createAnonClient } from "@/lib/captacao/public-organization"
import { parseProposalDocument, type ProposalDocument } from "@/lib/propostas/document"
import type { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Documento da proposta para a equipe (RLS: membro da imobiliária). */
export async function getProposalDocument(
  supabase: ServerClient,
  proposalId: string
): Promise<ProposalDocument | null> {
  const { data, error } = await supabase.rpc("get_proposal_document", {
    p_proposal_id: proposalId,
  })

  if (error) {
    // Só o código: nada de dados da proposta no log.
    console.error(`[propostas/pdf] get_proposal_document falhou: ${error.code ?? "erro"}`)
    return null
  }

  return parseProposalDocument(data)
}

/** Documento do link público. Memoizado por requisição (página + metadata). */
export const getSharedProposalDocument = cache(
  async (token: string): Promise<ProposalDocument | null> => {
    if (!isProposalShareToken(token)) {
      return null
    }

    const supabase = createAnonClient()
    const { data, error } = await supabase.rpc("get_shared_proposal", { p_token: token })

    if (error) {
      console.error(`[propostas/link] get_shared_proposal falhou: ${error.code ?? "erro"}`)
      return null
    }

    return parseProposalDocument(data)
  }
)

/**
 * Marca a abertura do link. Silenciosa por natureza: nunca conta ao visitante
 * se o token existe, e falha de rede não pode derrubar a página do cliente.
 */
export async function registerSharedProposalView(token: string): Promise<void> {
  if (!isProposalShareToken(token)) {
    return
  }

  try {
    const supabase = createAnonClient()
    const { error } = await supabase.rpc("register_shared_proposal_view", { p_token: token })

    if (error) {
      console.error(
        `[propostas/link] register_shared_proposal_view falhou: ${error.code ?? "erro"}`
      )
    }
  } catch {
    // Supabase não configurado ou rede fora: o registro de leitura é opcional.
  }
}

// Logo da imobiliária no PDF ---------------------------------------------------

const LOGO_MAX_BYTES = 1_500_000
const LOGO_TIMEOUT_MS = 4_000
const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/jpg"]

function isPrivateIpv4(host: string) {
  const parts = host.split(".").map(Number)

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }

  const [a = 0, b = 0] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

function isPrivateIpv6(host: string) {
  const address = host.replace(/^\[|\]$/g, "").toLowerCase()

  // IPv4 mapeado (::ffff:10.0.0.1) esconde um endereço v4 dentro de um v6.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)

  if (mapped?.[1]) {
    return isPrivateIpv4(mapped[1])
  }

  return (
    address === "::" ||
    address === "::1" ||
    /^f[cd]/.test(address) || // fc00::/7, únicos locais
    /^fe[89ab]/.test(address) // fe80::/10, link-local
  )
}

/**
 * O nome do host resolve para endereço público? A checagem de formato acima
 * barra só IP literal; sem isto, `logo.exemplo.com` apontando para 169.254.169.254
 * levaria o servidor a bater na rede interna da hospedagem.
 *
 * Não é à prova de DNS rebinding (entre esta resolução e a do fetch existe uma
 * janela), mas fecha o caso realista: host mal configurado ou apontado de
 * propósito para dentro. O que sobra é cego — a resposta só é usada se for PNG
 * ou JPEG de verdade e couber no limite de tamanho.
 */
async function resolvesToPublicAddress(hostname: string) {
  try {
    const addresses = await lookup(hostname, { all: true })

    return (
      addresses.length > 0 &&
      addresses.every(({ address, family }) =>
        family === 6 ? !isPrivateIpv6(address) : !isPrivateIpv4(address)
      )
    )
  } catch {
    return false
  }
}

/**
 * O endereço do logo é digitado pelo dono da imobiliária em Configurações.
 * Antes de o servidor buscá-lo: só https, sem host interno e sem IP privado
 * (nada de usar o CRM para alcançar a rede de dentro).
 */
function isPublicImageUrl(value: string) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== "https:") {
    return false
  }

  const host = url.hostname.toLowerCase()

  if (
    host === "localhost" ||
    host.startsWith("[") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return false
  }

  return !/^\d+\.\d+\.\d+\.\d+$/.test(host) || !isPrivateIpv4(host)
}

async function requestImage(url: string) {
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
    headers: { Accept: "image/png,image/jpeg" },
  })
}

/**
 * Baixa o logo (PNG ou JPEG) para embutir no PDF. Qualquer problema devolve
 * null: o cabeçalho cai no nome da imobiliária, sem derrubar o documento.
 * Memoizado por requisição — o mesmo logo serve todas as páginas do PDF.
 */
export const fetchBrandLogo = cache(async (logoUrl: string | null): Promise<Uint8Array | null> => {
  if (!logoUrl || !isPublicImageUrl(logoUrl)) {
    return null
  }

  try {
    if (!(await resolvesToPublicAddress(new URL(logoUrl).hostname))) {
      return null
    }

    let response = await requestImage(logoUrl)

    // Um salto de redirecionamento (CDNs costumam usar), revalidando o destino.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      const next = location ? new URL(location, logoUrl).toString() : null

      if (!next || !isPublicImageUrl(next)) {
        return null
      }

      if (!(await resolvesToPublicAddress(new URL(next).hostname))) {
        return null
      }

      response = await requestImage(next)
    }

    if (!response.ok) {
      return null
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()

    if (!contentType || !LOGO_CONTENT_TYPES.includes(contentType)) {
      return null
    }

    const length = Number(response.headers.get("content-length"))

    if (Number.isFinite(length) && length > LOGO_MAX_BYTES) {
      return null
    }

    const buffer = await response.arrayBuffer()

    return buffer.byteLength > LOGO_MAX_BYTES ? null : new Uint8Array(buffer)
  } catch {
    return null
  }
})
