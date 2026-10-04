import "server-only"

/**
 * Busca de processos por CPF/CNPJ na API do Escavador (serviço pago, cobra
 * créditos por consulta). Endpoint: GET https://api.escavador.com/api/v2/envolvido/processos
 * Env: ESCAVADOR_TOKEN.
 */

export type ProcessoEnvolvido = {
  numero: string
  poloAtivo: string | null
  poloPassivo: string | null
  inicio: string | null
  tribunais: string[]
  classe: string | null
}

export class EscavadorErro extends Error {
  constructor(public status: number) {
    super(`Escavador respondeu ${status}`)
  }
}

export function cpfValido(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false
  const calc = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export function cnpjValido(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => {
    const pesos =
      n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = pesos.reduce((a, p, i) => a + Number(d[i]) * p, 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

export function mascarar(d: string) {
  return d.length === 11 ? `***.${d.slice(3, 6)}.***-**` : `**.${d.slice(2, 5)}.***/****-**`
}

type Item = Record<string, unknown>

export async function processosPorDocumento(
  doc: string
): Promise<{ itens: ProcessoEnvolvido[]; creditos: string | null }> {
  const token = process.env.ESCAVADOR_TOKEN?.trim()
  if (!token) throw new EscavadorErro(503)
  const url = new URL("https://api.escavador.com/api/v2/envolvido/processos")
  url.searchParams.set("cpf_cnpj", doc)
  url.searchParams.set("limit", "50")
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new EscavadorErro(res.status)
  const j = (await res.json()) as { items?: Item[] }
  const itens = (j.items ?? []).map((p) => {
    const fontes = Array.isArray(p.fontes) ? (p.fontes as Item[]) : []
    const capa = (fontes[0]?.capa ?? {}) as Item
    return {
      numero: String(p.numero_cnj ?? ""),
      poloAtivo: typeof p.titulo_polo_ativo === "string" ? p.titulo_polo_ativo : null,
      poloPassivo: typeof p.titulo_polo_passivo === "string" ? p.titulo_polo_passivo : null,
      inicio: typeof p.data_inicio === "string" ? p.data_inicio : null,
      tribunais: fontes
        .map((f) => ((f.tribunal ?? {}) as Item).sigla ?? f.sigla)
        .filter((x): x is string => typeof x === "string"),
      classe: typeof capa.classe === "string" ? capa.classe : null,
    }
  })
  return { itens, creditos: res.headers.get("Creditos-Utilizados") }
}
