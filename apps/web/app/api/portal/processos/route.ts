import { cnjValido, consultarProcesso, DatajudErro, soDigitos } from "@/lib/portal/datajud"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/**
 * Consulta processual (Datajud/CNJ) para quem tem conta no portal.
 * POST { numero: "0000000-00.0000.0.00.0000", tribunal?: "tjrj" }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const LIMITE: Record<string, number> = { gratis: 3, essencial: 10, profissional: 50, premium: 2000 }

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u) return json(401, { erro: "Entre na sua conta para consultar processos." })

  let corpo: { numero?: unknown; tribunal?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return json(400, { erro: "Pedido inválido." })
  }
  const d = soDigitos(String(corpo.numero ?? ""))
  if (d.length !== 20)
    return json(400, { erro: "Informe o número completo do processo (20 dígitos)." })

  // Limite mensal por plano. Sem a tabela (banco ainda não atualizado), não limita.
  const limite = LIMITE[u.plano] ?? 3
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count, error: errContagem } = await u.sb
    .from("consultas_processuais")
    .select("id", { count: "exact", head: true })
    .eq("user_id", u.id)
    .gte("criado", inicioMes)
  if (!errContagem && (count ?? 0) >= limite) {
    return json(429, {
      erro: `Você usou as ${limite} consultas do mês no seu plano. Veja os planos para consultar mais.`,
    })
  }

  try {
    const resultado = await consultarProcesso(
      d,
      typeof corpo.tribunal === "string" ? corpo.tribunal : undefined
    )
    if (!errContagem) await u.sb.from("consultas_processuais").insert({ user_id: u.id, numero: d })
    return json(200, { processos: resultado, dvConfere: cnjValido(d) })
  } catch (e) {
    const s = e instanceof DatajudErro ? e.status : 502
    if (s === 400)
      return json(400, { erro: "Não reconheci o tribunal pelo número. Escolha o tribunal." })
    if (s === 503) return json(503, { erro: "Consulta processual ainda não configurada." })
    return json(502, { erro: "O Datajud não respondeu agora. Tente de novo em instantes." })
  }
}
