import "server-only"

export type CepAddress = {
  postalCode: string
  street: string
  neighborhood: string
  city: string
  state: string
}

const TIMEOUT_MS = 5000

/**
 * Identificação nas consultas à BrasilAPI e ao ViaCEP. Sem ela o fetch do Node
 * manda `User-Agent: node`, que o Cloudflare da BrasilAPI recusa (403 na
 * consulta de CNPJ; 429 pelo servidor do Next), e a consulta nunca preenche.
 */
export const BR_LOOKUP_USER_AGENT = "PlataformaImobiliariaCRM/1.0 (consulta de CEP e CNPJ)"
const ONE_MONTH_SECONDS = 60 * 60 * 24 * 30
const POSTAL_CODE_PATTERN = /^\d{8}$/

async function fetchJson(url: URL): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": BR_LOOKUP_USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: ONE_MONTH_SECONDS },
    })
    if (!response.ok) return null
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

/** Consulta o CEP no ViaCEP e, se falhar, na BrasilAPI. Retorna null se não encontrar. */
export async function lookupCep(value: string): Promise<CepAddress | null> {
  const postalCode = value.replace(/\D/g, "")
  // Só 8 dígitos chegam à URL; host e caminho são fixos (sem risco de SSRF).
  if (!POSTAL_CODE_PATTERN.test(postalCode)) return null

  const viaCep = await fetchJson(new URL(`/ws/${postalCode}/json/`, "https://viacep.com.br"))
  if (viaCep && !viaCep.erro && text(viaCep.localidade)) {
    return {
      postalCode,
      street: text(viaCep.logradouro),
      neighborhood: text(viaCep.bairro),
      city: text(viaCep.localidade),
      state: text(viaCep.uf),
    }
  }

  const brasilApi = await fetchJson(
    new URL(`/api/cep/v2/${postalCode}`, "https://brasilapi.com.br")
  )
  if (brasilApi && text(brasilApi.city)) {
    return {
      postalCode,
      street: text(brasilApi.street),
      neighborhood: text(brasilApi.neighborhood),
      city: text(brasilApi.city),
      state: text(brasilApi.state),
    }
  }

  return null
}
