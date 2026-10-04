import "server-only"

import { extractText, getDocumentProxy } from "unpdf"

/**
 * Leitura automática de certidões e matrículas em PDF.
 *
 * Duas camadas:
 * 1. Regras: procura no texto do PDF os termos que costumam indicar ônus ou
 *    pendência (penhora, hipoteca, indisponibilidade...) e devolve o trecho.
 *    Funciona sempre, mas não lê PDF escaneado (imagem sem texto).
 * 2. IA (opcional): com ANTHROPIC_API_KEY, o PDF vai para o modelo, que lê
 *    inclusive escaneado e escreve o resumo. O texto da IA é conferido contra
 *    os trechos; nada é inventado no relatório sem trecho de origem.
 *
 * É uma leitura de apoio, não um parecer jurídico.
 */

export type Achado = {
  termo: string
  gravidade: "alta" | "media" | "info"
  categoria: string
  trecho: string
  cancelado: boolean
}

export type Leitura = {
  paginas: number
  temTexto: boolean
  achados: Achado[]
  ia: {
    resumo: string
    pendencias: { tipo: string; gravidade: string; trecho: string; explicacao: string }[]
    faltando: string[]
    conclusao: string
  } | null
}

const REGRAS: { re: RegExp; termo: string; gravidade: Achado["gravidade"]; categoria: string }[] = [
  { re: /penhora/gi, termo: "Penhora", gravidade: "alta", categoria: "Constrição judicial" },
  { re: /arresto/gi, termo: "Arresto", gravidade: "alta", categoria: "Constrição judicial" },
  { re: /sequestro/gi, termo: "Sequestro", gravidade: "alta", categoria: "Constrição judicial" },
  {
    re: /indisponibilidade/gi,
    termo: "Indisponibilidade de bens",
    gravidade: "alta",
    categoria: "Constrição judicial",
  },
  { re: /arrolamento/gi, termo: "Arrolamento", gravidade: "alta", categoria: "Fiscal" },
  {
    re: /fal[eê]ncia|recupera[cç][aã]o judicial/gi,
    termo: "Falência ou recuperação judicial",
    gravidade: "alta",
    categoria: "Empresarial",
  },
  { re: /usucapi[aã]o/gi, termo: "Usucapião", gravidade: "alta", categoria: "Posse e propriedade" },
  {
    re: /a[cç][aã]o (de )?(execu[cç][aã]o|reivindicat[oó]ria|anulat[oó]ria|possess[oó]ria)/gi,
    termo: "Ação judicial citada",
    gravidade: "alta",
    categoria: "Ação judicial",
  },
  { re: /hipoteca/gi, termo: "Hipoteca", gravidade: "media", categoria: "Garantia" },
  {
    re: /aliena[cç][aã]o fiduci[aá]ria/gi,
    termo: "Alienação fiduciária",
    gravidade: "media",
    categoria: "Garantia",
  },
  {
    re: /consolida[cç][aã]o da propriedade/gi,
    termo: "Consolidação da propriedade",
    gravidade: "info",
    categoria: "Garantia",
  },
  { re: /usufruto/gi, termo: "Usufruto", gravidade: "media", categoria: "Direito de terceiro" },
  {
    re: /inalienabilidade|impenhorabilidade|incomunicabilidade/gi,
    termo: "Cláusula restritiva",
    gravidade: "media",
    categoria: "Restrição",
  },
  { re: /servid[aã]o/gi, termo: "Servidão", gravidade: "media", categoria: "Direito de terceiro" },
  {
    re: /enfiteuse|aforamento|laud[eê]mio|terreno de marinha/gi,
    termo: "Enfiteuse ou terreno de marinha",
    gravidade: "media",
    categoria: "Domínio",
  },
  { re: /d[ií]vida ativa/gi, termo: "Dívida ativa", gravidade: "alta", categoria: "Débito" },
  { re: /\bpositiva\b/gi, termo: "Certidão positiva", gravidade: "media", categoria: "Débito" },
  {
    re: /positiva com efeito de negativa/gi,
    termo: "Positiva com efeito de negativa",
    gravidade: "info",
    categoria: "Débito",
  },
  {
    re: /nada consta|certid[aã]o negativa/gi,
    termo: "Nada consta / negativa",
    gravidade: "info",
    categoria: "Sem pendência",
  },
]

function limpar(t: string) {
  return t.replace(/\s+/g, " ").trim()
}

export function analisarTexto(texto: string): Achado[] {
  const t = limpar(texto)
  const achados: Achado[] = []
  const posicoes: [string, number][] = []
  for (const r of REGRAS) {
    for (const m of t.matchAll(r.re)) {
      const i = m.index ?? 0
      const trecho = t.slice(Math.max(0, i - 140), Math.min(t.length, i + 180))
      const antes = t.slice(Math.max(0, i - 60), i)
      const depois = t.slice(i, i + 120).split(/\.\s|\bR\.\s?\d|\bAV\.\s?\d/i)[0] ?? ""
      const cancelado = /cancelad[ao]|cancelamento|baixa d[ae]|levantamento/i.test(
        antes.slice(
          antes.search(/(\.\s|\bR\.\s?\d|\bAV\.\s?\d)(?!.*(\.\s|\bR\.\s?\d|\bAV\.\s?\d))/i) + 1
        ) + depois
      )
      if (posicoes.some(([termo, pos]) => termo === r.termo && Math.abs(pos - i) < 20)) continue
      posicoes.push([r.termo, i])
      achados.push({
        termo: r.termo,
        gravidade: r.gravidade,
        categoria: r.categoria,
        trecho,
        cancelado,
      })
      if (achados.filter((a) => a.termo === r.termo).length >= 4) break
    }
  }
  const peso = { alta: 0, media: 1, info: 2 }
  return achados.sort((a, b) => peso[a.gravidade] - peso[b.gravidade])
}

const PROMPT = `Você é um analista de documentação imobiliária. Leia o PDF (matrícula, certidão de ônus reais, certidões de débitos ou de distribuidores) e responda SOMENTE com um JSON válido, sem texto fora dele, no formato:
{"resumo": "o que é o documento, imóvel, cartório e data, em até 3 frases",
 "pendencias": [{"tipo": "ex.: penhora, hipoteca, débito de IPTU", "gravidade": "alta|media|baixa", "trecho": "trecho literal do documento", "explicacao": "por que isso importa para quem vai comprar"}],
 "faltando": ["documentos que normalmente faltam para concluir a análise"],
 "conclusao": "frase curta: há ou não pendência aparente no documento lido"}
Regras: nunca invente; todo item de "pendencias" precisa de trecho literal do documento; se um ônus aparece cancelado ou baixado, diga isso; se o documento estiver ilegível, diga na conclusão. Português do Brasil, linguagem simples.`

async function lerComIa(pdf: Uint8Array): Promise<Leitura["ia"]> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim()
  if (!chave) return null
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": chave,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CERTIDOES_MODELO?.trim() || "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: Buffer.from(pdf).toString("base64"),
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(50_000),
  })
  if (!res.ok) return null
  const j = (await res.json()) as { content?: { type: string; text?: string }[] }
  const texto = j.content?.find((c) => c.type === "text")?.text ?? ""
  const bruto = texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1)
  try {
    const o = JSON.parse(bruto) as NonNullable<Leitura["ia"]>
    return {
      resumo: String(o.resumo ?? ""),
      pendencias: Array.isArray(o.pendencias) ? o.pendencias.slice(0, 30) : [],
      faltando: Array.isArray(o.faltando) ? o.faltando.slice(0, 15).map(String) : [],
      conclusao: String(o.conclusao ?? ""),
    }
  } catch {
    return null
  }
}

export async function lerCertidao(pdf: Uint8Array): Promise<Leitura> {
  let texto = ""
  let paginas = 0
  try {
    const doc = await getDocumentProxy(pdf.slice())
    const r = await extractText(doc, { mergePages: true })
    paginas = r.totalPages
    texto = Array.isArray(r.text) ? r.text.join("\n") : r.text
  } catch {
    texto = ""
  }
  const temTexto = limpar(texto).length > 80
  const [ia] = await Promise.all([lerComIa(pdf)])
  return { paginas, temTexto, achados: temTexto ? analisarTexto(texto) : [], ia }
}
