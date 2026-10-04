/**
 * Consulta da Tabela FIPE para as calculadoras (marcas, modelos, anos e preço), via API
 * pública parallelum.com.br, com cache de um dia. Só aceita códigos numéricos, sem URL livre.
 */

export const runtime = "nodejs"

const BASE = "https://parallelum.com.br/fipe/api/v1"
const TIPOS = new Set(["carros", "motos", "caminhoes"])

const json = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": status === 200 ? "public, s-maxage=86400" : "no-store" },
  })

export async function GET(request: Request) {
  const u = new URL(request.url)
  const tipo = u.searchParams.get("tipo") ?? ""
  const marca = u.searchParams.get("marca") ?? ""
  const modelo = u.searchParams.get("modelo") ?? ""
  const ano = u.searchParams.get("ano") ?? ""
  if (!TIPOS.has(tipo)) return json(400, { erro: "tipo" })
  if ((marca && !/^\d{1,6}$/.test(marca)) || (modelo && !/^\d{1,8}$/.test(modelo)))
    return json(400, { erro: "codigo" })
  if (ano && !/^\d{4,5}-\d{1,2}$/.test(ano)) return json(400, { erro: "ano" })

  let caminho = `/${tipo}/marcas`
  if (marca) caminho += `/${marca}/modelos`
  if (marca && modelo) caminho += `/${modelo}/anos`
  if (marca && modelo && ano) caminho += `/${ano}`

  try {
    const r = await fetch(BASE + caminho, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return json(502, { erro: "fipe" })
    return json(200, await r.json())
  } catch {
    return json(502, { erro: "fipe" })
  }
}
