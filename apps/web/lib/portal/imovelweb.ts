import "server-only"

import { PORTAL } from "@/lib/portal/config"
import { brl, type PortalListing } from "@/lib/portal/imoveis"
import { siteUrl } from "@/lib/portal/site-url"

/**
 * Cliente da Open API do Imovelweb (Navent), em TypeScript.
 *
 * Portado do SDK PHP mrprompt/imovelweb-sdk (licença MIT, Thiago Paes):
 * mesmos caminhos, mesmo login por client_credentials e o mesmo corpo
 * `{ aviso: {...} }` na publicação. A API só funciona com as credenciais de
 * integrador que o Imovelweb libera (CLIENT_ID e CLIENT_SECRET) e com o código
 * da imobiliária no Imovelweb.
 *
 * Variáveis de ambiente (nenhuma vai para o navegador):
 * - IMOVELWEB_CLIENT_ID, IMOVELWEB_CLIENT_SECRET
 * - IMOVELWEB_CODIGO_IMOBILIARIA
 * - IMOVELWEB_AMBIENTE = production | sandbox (padrão sandbox, por segurança)
 * - IMOVELWEB_API_URL (opcional, para trocar o endereço da API)
 */

const URLS = {
  production: "https://api-br.open.navent.com/v1/",
  sandbox: "https://api-br.sandbox.open.navent.com/v1/",
} as const

type Json = Record<string, unknown>

export type ImovelwebConfig = {
  clientId: string
  clientSecret: string
  imobiliaria: string
  baseUrl: string
}

export function imovelwebConfig(): ImovelwebConfig | null {
  const clientId = process.env.IMOVELWEB_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.IMOVELWEB_CLIENT_SECRET?.trim() ?? ""
  const imobiliaria = process.env.IMOVELWEB_CODIGO_IMOBILIARIA?.trim() ?? ""
  if (!clientId || !clientSecret || !imobiliaria) return null
  const ambiente = process.env.IMOVELWEB_AMBIENTE === "production" ? "production" : "sandbox"
  const custom = process.env.IMOVELWEB_API_URL?.trim()
  const baseUrl =
    custom && /^https:\/\//.test(custom) ? custom.replace(/\/?$/, "/") : URLS[ambiente]
  return { clientId, clientSecret, imobiliaria, baseUrl }
}

export class ImovelwebErro extends Error {
  constructor(
    public status: number,
    public caminho: string
  ) {
    super(`Imovelweb respondeu ${status} em ${caminho}`)
  }
}

export class Imovelweb {
  private constructor(
    private cfg: ImovelwebConfig,
    private token: string
  ) {}

  /** Login da aplicação (POST application/login, client_credentials). */
  static async conectar(cfg: ImovelwebConfig): Promise<Imovelweb> {
    const res = await fetch(new URL("application/login", cfg.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
      cache: "no-store",
    })
    if (!res.ok) throw new ImovelwebErro(res.status, "application/login")
    const data = (await res.json()) as { access_token?: string }
    if (!data.access_token) throw new ImovelwebErro(502, "application/login")
    return new Imovelweb(cfg, data.access_token)
  }

  private async req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const res = await fetch(new URL(caminho, this.cfg.baseUrl), {
      method: metodo,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
    })
    if (!res.ok) throw new ImovelwebErro(res.status, caminho.split("?")[0] ?? caminho)
    const texto = await res.text()
    return (texto ? JSON.parse(texto) : {}) as T
  }

  private get imob() {
    return `imobiliarias/${encodeURIComponent(this.cfg.imobiliaria)}`
  }

  // Anúncios
  resumo(args: Record<string, string> = {}) {
    const q = new URLSearchParams(args).toString()
    return this.req<Json>("GET", `${this.imob}/anuncios${q ? `?${q}` : ""}`)
  }
  info(anuncio: string) {
    return this.req<Json>("GET", `${this.imob}/anuncios/${encodeURIComponent(anuncio)}`)
  }
  atualizar(anuncio: string, aviso: Json) {
    return this.req<Json>("PUT", `${this.imob}/anuncios/${encodeURIComponent(anuncio)}`, {
      aviso,
    })
  }
  remover(anuncio: string) {
    return this.req<Json>("DELETE", `${this.imob}/anuncios/${encodeURIComponent(anuncio)}`)
  }
  status(anuncio: string) {
    return this.req<Json>("GET", `${this.imob}/anuncios/${encodeURIComponent(anuncio)}/status`)
  }

  // Inventário (códigos que o Imovelweb exige no anúncio)
  tiposDePropriedade() {
    return this.req<{ id: string; nombre: string }[]>("GET", "tipopropriedade")
  }
  operacoes() {
    return this.req<{ id?: string; operacion?: string; nombre?: string }[]>("GET", "operacoes")
  }
  localPorCoordenada(lat: number, lng: number) {
    return this.req<{ id: string; nombreCompleto?: string }[]>(
      "GET",
      `locais/latitude-longitude/${lat},${lng}/countryCode/BR`
    )
  }

  // Contatos (leads) e callbacks
  mensagem(id: string) {
    return this.req<Json>("GET", `mensagens/${encodeURIComponent(id)}`)
  }
  configurarCallback(url: string, headerKey: string, headerValue: string) {
    return this.req<Json>("PUT", "configuracao/callbacks", {
      configuracoes: {
        url,
        authorizationHeaderKey: headerKey,
        authorizationHeaderValue: headerValue,
        lenguajeCallbackBody: "EN",
      },
    })
  }
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/** Tipo do portal → nomes que o Imovelweb costuma usar no cadastro de tipos. */
const TIPO_IMOVELWEB: Record<string, string[]> = {
  Apartamento: ["apartamento"],
  Casa: ["casa"],
  Sobrado: ["casa", "sobrado"],
  Terreno: ["terreno", "lote"],
  Gleba: ["terreno", "area"],
  Sala: ["sala comercial", "conjunto comercial", "sala"],
  Loja: ["loja", "ponto comercial"],
  Comercial: ["comercial", "sala comercial"],
  Galpão: ["galpao", "deposito"],
  Prédio: ["predio", "edificio"],
  "Imóvel rural": ["rural", "fazenda", "sitio", "chacara"],
}

export type Catalogo = {
  tipos: { id: string; nombre: string }[]
  operacaoVenda: string | null
}

export async function carregarCatalogo(api: Imovelweb): Promise<Catalogo> {
  const [tipos, ops] = await Promise.all([api.tiposDePropriedade(), api.operacoes()])
  const venda = ops.find((o) => /vend|venta|sale/.test(sem(o.nombre ?? o.operacion ?? "")))
  return { tipos, operacaoVenda: venda ? String(venda.id ?? venda.operacion ?? "") : null }
}

/**
 * Monta o "aviso" do Imovelweb a partir do imóvel do portal. Devolve o motivo
 * quando falta algo que o Imovelweb exige (tipo, localização ou fotos).
 */
export async function avisoDe(
  api: Imovelweb,
  cat: Catalogo,
  i: PortalListing,
  contato: { email: string; nome: string; telefone: string }
): Promise<{ ok: true; aviso: Json } | { ok: false; motivo: string }> {
  const nomes = TIPO_IMOVELWEB[i.tipo] ?? [sem(i.tipo)]
  const tipo = cat.tipos.find((t) => nomes.some((n) => sem(t.nombre).includes(n)))
  if (!tipo) return { ok: false, motivo: `tipo "${i.tipo}" sem correspondente no Imovelweb` }
  if (!cat.operacaoVenda) return { ok: false, motivo: "operação de venda não encontrada" }
  if (i.latitude == null || i.longitude == null) return { ok: false, motivo: "sem coordenadas" }
  const locais = await api.localPorCoordenada(i.latitude, i.longitude)
  const local = locais[0]
  if (!local) return { ok: false, motivo: "localização não encontrada no Imovelweb" }
  if (i.fotos.length < 1) return { ok: false, motivo: "sem fotos próprias" }

  const titulo = `${i.tipo} de leilão em ${i.bairro ?? i.cidade}`.slice(0, 90)
  const descricao = [
    `${i.tipo} de leilão (${i.origemNome}${i.modalidade ? `, ${i.modalidade}` : ""}) em ${[i.bairro, i.cidade, i.uf].filter(Boolean).join(", ")}.`,
    `Valor mínimo ${brl(i.preco)}${i.valorAvaliacao ? `, avaliação ${brl(i.valorAvaliacao)}` : ""}.`,
    i.descricao ?? "",
    "Condições, dívidas e ocupação conforme o edital e a matrícula.",
    `Ficha completa: ${siteUrl()}/leiloes/${i.numero}`,
    `${PORTAL.legalName}, ${PORTAL.creci}.`,
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    ok: true,
    aviso: {
      claveReferencia: i.numero,
      titulo,
      descripcion: descricao,
      tipoDePropiedad: { idTipo: tipo.id, tipo: tipo.nombre },
      precios: [
        { moneda: "BRL", monto: String(Math.round(i.preco)), operacion: cat.operacaoVenda },
      ],
      localizacion: {
        idUbicacion: local.id,
        direccion: i.endereco,
        codigoPostal: (i.cep ?? "").replace(/\D/g, ""),
        latitud: String(i.latitude),
        longitud: String(i.longitude),
        muestraMapa: "APROXIMADO",
      },
      multimedia: {
        imagenes: i.fotos.slice(0, 30).map((u, n) => ({
          titulo: `Foto ${n + 1}`,
          urlImagenOriginal: u,
        })),
      },
      publicador: {
        codigoInmobiliaria: process.env.IMOVELWEB_CODIGO_IMOBILIARIA ?? "",
        emailDeContacto: contato.email,
        nombreDeContacto: contato.nome,
        telefonoDeContacto: contato.telefone,
      },
    },
  }
}
