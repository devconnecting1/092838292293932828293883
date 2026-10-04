import { lerCertidao } from "@/lib/portal/certidoes"
import { RANK } from "@/lib/portal/planos"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/** Leitura de certidões em PDF (planos pagos). O arquivo não é guardado. */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const LIMITE: Record<string, number> = { essencial: 5, profissional: 30, premium: 300 }
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u) return json(401, { erro: "Entre na sua conta." })
  if ((RANK[u.plano] ?? 0) < 1)
    return json(402, { erro: "A leitura de certidões faz parte dos planos pagos." })

  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count, error: errUso } = await u.sb
    .from("uso_ferramentas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", u.id)
    .eq("ferramenta", "certidao")
    .gte("criado", inicioMes)
  const limite = LIMITE[u.plano] ?? 0
  if (!errUso && (count ?? 0) >= limite)
    return json(429, { erro: `Você usou as ${limite} leituras do mês no seu plano.` })

  const fd = await request.formData().catch(() => null)
  const arq = fd?.get("arquivo")
  if (!(arq instanceof File)) return json(400, { erro: "Envie o PDF da certidão." })
  if (arq.type !== "application/pdf" || arq.size > 10 * 1024 * 1024)
    return json(400, { erro: "Envie um PDF de até 10 MB." })
  const bytes = new Uint8Array(await arq.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF")
    return json(400, { erro: "Arquivo não é PDF." })

  const leitura = await lerCertidao(bytes)
  if (!errUso)
    await u.sb.from("uso_ferramentas").insert({
      user_id: u.id,
      ferramenta: "certidao",
      referencia: arq.name.slice(0, 120),
    })
  return json(200, leitura)
}
