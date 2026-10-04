import { gravarLeadPortal } from "@/lib/portal/leads-portais"
import { segredoConfere, tokenPortal } from "@/lib/portal/integracao-auth"
import { Imovelweb, imovelwebConfig } from "@/lib/portal/imovelweb"

/**
 * Callback de contatos do Imovelweb. O endereço e o cabeçalho de autorização
 * são registrados pela própria API (PUT configuracao/callbacks), na rota de
 * sincronização. Header esperado: X-Vamos-Arrematar: <IMOVELWEB_CALLBACK_SECRET>.
 *
 * O formato exato do corpo do callback não está no SDK [VERIFICAR com o
 * Imovelweb]. Por isso o leitor procura os campos pelos nomes usados na API
 * (nombre, email, telefono, mensaje, codigoAviso) e, se vier só o código da
 * mensagem, busca o contato em GET mensagens/{id}.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const r = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } })

type J = Record<string, unknown>

function achar(o: unknown, nomes: string[], prof = 0): string | null {
  if (!o || typeof o !== "object" || prof > 4) return null
  for (const [k, v] of Object.entries(o as J)) {
    if (nomes.includes(k.toLowerCase()) && (typeof v === "string" || typeof v === "number"))
      return String(v).trim() || null
  }
  for (const v of Object.values(o as J)) {
    const x = achar(v, nomes, prof + 1)
    if (x) return x
  }
  return null
}

export async function POST(request: Request) {
  const secreto = process.env.IMOVELWEB_CALLBACK_SECRET
  const url = new URL(request.url)
  if (
    !segredoConfere(request.headers.get("x-vamos-arrematar"), secreto) &&
    !segredoConfere(url.searchParams.get("token"), tokenPortal())
  )
    return r(401)

  const raw = await request.text()
  if (raw.length > 65_536) return r(413)
  let body: J
  try {
    body = JSON.parse(raw) as J
  } catch {
    return r(400)
  }

  let fonte: unknown = body
  const idMsg = achar(body, ["codigomensaje", "idmensaje", "mensajeid", "messageid"])
  if (!achar(body, ["email", "telefono", "phone"]) && idMsg) {
    const cfg = imovelwebConfig()
    if (cfg) {
      try {
        fonte = await (await Imovelweb.conectar(cfg)).mensagem(idMsg)
      } catch {
        return r(503)
      }
    }
  }

  const nome = achar(fonte, ["nombre", "name", "nome"]) ?? "Contato do Imovelweb"
  const ok = await gravarLeadPortal({
    imovelId: achar(fonte, ["clavereferencia", "codigoreferencia"]),
    nome,
    telefone: achar(fonte, ["telefono", "phone", "telefone"]),
    email: achar(fonte, ["email", "mail"]),
    mensagem: [
      "[imovelweb]",
      idMsg ? `mensagem ${idMsg}` : null,
      achar(fonte, ["codigoaviso"]) ? `anúncio ${achar(fonte, ["codigoaviso"])}` : null,
      achar(fonte, ["mensaje", "message", "texto"]),
    ]
      .filter(Boolean)
      .join(" · "),
    origem: "imovelweb",
  })
  return r(ok ? 200 : 503)
}

export function GET() {
  return r(405)
}
