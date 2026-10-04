import {
  cnpjValido,
  cpfValido,
  EscavadorErro,
  mascarar,
  processosPorDocumento,
} from "@/lib/portal/escavador"
import { RANK } from "@/lib/portal/planos"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/**
 * Processos por CPF/CNPJ (planos Profissional e Premium).
 * LGPD: exige a finalidade (análise de imóvel/negócio), registra quem consultou
 * e guarda só o documento mascarado.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const LIMITE: Record<string, number> = { profissional: 20, premium: 200 }
const FINALIDADES = [
  "vendedor do imóvel",
  "ocupante do imóvel",
  "devedor do processo do leilão",
  "parte de negócio imobiliário",
]
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u) return json(401, { erro: "Entre na sua conta." })
  if ((RANK[u.plano] ?? 0) < 2)
    return json(402, { erro: "A busca por CPF/CNPJ faz parte dos planos Profissional e Premium." })

  let corpo: { documento?: unknown; finalidade?: unknown; ciente?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return json(400, { erro: "Pedido inválido." })
  }
  const d = String(corpo.documento ?? "").replace(/\D/g, "")
  if (!(cpfValido(d) || cnpjValido(d))) return json(400, { erro: "CPF ou CNPJ inválido." })
  const finalidade = String(corpo.finalidade ?? "")
  if (!FINALIDADES.includes(finalidade) || corpo.ciente !== true)
    return json(400, { erro: "Informe a finalidade da consulta e confirme o termo." })

  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count, error: errUso } = await u.sb
    .from("uso_ferramentas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", u.id)
    .eq("ferramenta", "cpf_cnpj")
    .gte("criado", inicioMes)
  const limite = LIMITE[u.plano] ?? 0
  if (!errUso && (count ?? 0) >= limite)
    return json(429, { erro: `Você usou as ${limite} buscas do mês no seu plano.` })

  try {
    const r = await processosPorDocumento(d)
    if (!errUso)
      await u.sb.from("uso_ferramentas").insert({
        user_id: u.id,
        ferramenta: "cpf_cnpj",
        referencia: mascarar(d),
        finalidade,
      })
    return json(200, { processos: r.itens })
  } catch (e) {
    const s = e instanceof EscavadorErro ? e.status : 502
    if (s === 503) return json(503, { erro: "Busca por CPF/CNPJ ainda não ativada." })
    return json(502, { erro: "O serviço de busca não respondeu agora." })
  }
}
