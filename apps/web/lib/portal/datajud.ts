import "server-only"

/**
 * Consulta processual pela API Pública do Datajud (CNJ).
 * Endpoint: https://api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search
 * Autenticação: "Authorization: APIKey <chave pública>" — a chave é publicada
 * pelo CNJ em datajud-wiki.cnj.jus.br/api-publica/acesso e pode mudar a
 * qualquer momento; por isso fica na variável DATAJUD_API_KEY.
 *
 * A API pública traz metadados de processos públicos (classe, órgão julgador,
 * assuntos, movimentos). Não traz nomes das partes nem processos em sigilo.
 */

const BASE = "https://api-publica.datajud.cnj.jus.br/"

/** Justiça estadual: código TR do número CNJ (Res. CNJ 65/2008) → sigla. */
const TJ = [
  "ac",
  "al",
  "ap",
  "am",
  "ba",
  "ce",
  "dft",
  "es",
  "go",
  "ma",
  "mt",
  "ms",
  "mg",
  "pa",
  "pb",
  "pr",
  "pe",
  "pi",
  "rj",
  "rn",
  "rs",
  "ro",
  "rr",
  "sc",
  "se",
  "sp",
  "to",
]

export type Movimento = { data: string; nome: string; complemento: string | null }

export type Processo = {
  numero: string
  tribunal: string
  classe: string | null
  sistema: string | null
  grau: string | null
  orgao: string | null
  ajuizamento: string | null
  atualizado: string | null
  assuntos: string[]
  movimentos: Movimento[]
}

export function soDigitos(n: string) {
  return n.replace(/\D/g, "")
}

/** Número no padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos). */
export function formatarCnj(d: string) {
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`
}

/** Dígito verificador do número CNJ (módulo 97). */
export function cnjValido(d: string) {
  if (!/^\d{20}$/.test(d)) return false
  const n = d.slice(0, 7)
  const dv = d.slice(7, 9)
  const resto = d.slice(9)
  const calc = 98 - Number(BigInt(n + resto + "00") % 97n)
  return calc === Number(dv)
}

/** Descobre o tribunal pelo segmento de justiça (J) e o código TR do número. */
export function aliasDoNumero(d: string): string | null {
  const j = d.slice(13, 14)
  const tr = Number(d.slice(14, 16))
  if (j === "8") return TJ[tr - 1] ? `tj${TJ[tr - 1]}` : null
  if (j === "4") return tr >= 1 && tr <= 6 ? `trf${tr}` : null
  if (j === "5") return tr >= 1 && tr <= 24 ? `trt${tr}` : tr === 0 ? "tst" : null
  if (j === "3") return "stj"
  if (j === "7") return "stm"
  return null
}

const ALIAS_OK =
  /^(tj[a-z]{2,3}|trf[1-6]|trt([1-9]|1\d|2[0-4])|tst|stj|stm|tse|tre-[a-z]{2}|tjm[a-z]{2})$/

type Fonte = Record<string, unknown>

function txt(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function nome(v: unknown) {
  return v && typeof v === "object" ? txt((v as Fonte).nome) : null
}

function ler(src: Fonte, alias: string): Processo {
  const movs = Array.isArray(src.movimentos) ? (src.movimentos as Fonte[]) : []
  return {
    numero: formatarCnj(soDigitos(String(src.numeroProcesso ?? ""))),
    tribunal: txt(src.tribunal) ?? alias.toUpperCase(),
    classe: nome(src.classe),
    sistema: nome(src.sistema),
    grau: txt(src.grau),
    orgao: nome(src.orgaoJulgador),
    ajuizamento: txt(src.dataAjuizamento),
    atualizado: txt(src.dataHoraUltimaAtualizacao),
    assuntos: (Array.isArray(src.assuntos) ? (src.assuntos as unknown[]) : [])
      .flat()
      .map(nome)
      .filter((x): x is string => !!x),
    movimentos: movs
      .map((m) => ({
        data: txt(m.dataHora) ?? "",
        nome: txt(m.nome) ?? "Movimento",
        complemento: Array.isArray(m.complementosTabelados)
          ? (m.complementosTabelados as Fonte[])
              .map((c) => txt(c.nome) ?? txt(c.descricao))
              .filter(Boolean)
              .join(", ") || null
          : null,
      }))
      .sort((a, b) => b.data.localeCompare(a.data))
      .slice(0, 80),
  }
}

export class DatajudErro extends Error {
  constructor(public status: number) {
    super(`Datajud respondeu ${status}`)
  }
}

/** Busca um processo pelo número CNJ (um registro por grau/instância). */
export async function consultarProcesso(numero: string, aliasManual?: string): Promise<Processo[]> {
  const chave = process.env.DATAJUD_API_KEY?.trim()
  if (!chave) throw new DatajudErro(503)
  const d = soDigitos(numero)
  const alias = aliasManual && ALIAS_OK.test(aliasManual) ? aliasManual : aliasDoNumero(d)
  if (!alias) throw new DatajudErro(400)
  const res = await fetch(`${BASE}api_publica_${alias}/_search`, {
    method: "POST",
    headers: { Authorization: `APIKey ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { match: { numeroProcesso: d } }, size: 5 }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new DatajudErro(res.status)
  const data = (await res.json()) as { hits?: { hits?: { _source?: Fonte }[] } }
  return (data.hits?.hits ?? []).map((h) => ler(h._source ?? {}, alias))
}
