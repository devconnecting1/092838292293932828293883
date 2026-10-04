"use client"

import * as React from "react"
import Link from "next/link"

import { resumirImoveis, type ItemResumo } from "@/app/(site)/anunciar/actions"
import { useAdCart } from "@/components/portal/ad-cart"
import { portalBrowserClient } from "@/lib/portal/browser-client"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const data = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "-")

type Portal = {
  slug: string
  nome: string
  preco_por_imovel: number | null
  preco_destaque: number | null
  dias: number
  ativo: boolean
  ordem: number
}

type Pedido = {
  id: string
  codigo: string
  imoveis: string[]
  itens: { imovel: string; tipo: string }[] | null
  portais: string[]
  dias: number
  valor: number | null
  gratuito: boolean
  status: string
  inicio: string | null
  fim: string | null
  renovar: boolean | null
  avisos: number
  nome: string
  criado: string
}

const STATUS: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago, aguardando aprovação",
  aprovado: "Publicado",
  recusado: "Recusado",
  expirado: "Encerrado",
  cancelado: "Cancelado",
}

async function token() {
  const sb = portalBrowserClient()
  return sb ? ((await sb.auth.getSession()).data.session?.access_token ?? null) : null
}

async function pagar(pedidoId: string): Promise<string | null> {
  const t = await token()
  const r = await fetch("/api/portal/anuncios/pagar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t ?? ""}` },
    body: JSON.stringify({ pedidoId }),
  })
  const j = (await r.json().catch(() => ({}))) as { url?: string; erro?: string }
  if (j.url) {
    window.location.href = j.url
    return null
  }
  return j.erro ?? "Não foi possível abrir o pagamento."
}

/** Seleção dos imóveis, tipo de anúncio (simples ou destaque), valor na hora e pagamento. */
export function PublicidadeCorretor() {
  const cart = useAdCart()
  const [itens, setItens] = React.useState<ItemResumo[]>([])
  const [tipos, setTipos] = React.useState<Record<string, "simples" | "destaque">>({})
  const [portais, setPortais] = React.useState<Portal[]>([])
  const [escolhidos, setEscolhidos] = React.useState<string[]>([])
  const [msg, setMsg] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const chave = cart.ids.join(",")

  React.useEffect(() => {
    let vivo = true
    resumirImoveis(chave ? chave.split(",") : []).then((r) => vivo && setItens(r))
    return () => {
      vivo = false
    }
  }, [chave])

  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    sb.from("portais")
      .select("*")
      .eq("ativo", true)
      .order("ordem")
      .then(({ data: d }) => {
        const ps = (d as Portal[] | null) ?? []
        setPortais(ps)
        setEscolhidos(ps.map((p) => p.slug))
      })
  }, [])

  const sel = portais.filter((p) => escolhidos.includes(p.slug))
  const precoDe = (p: Portal, t: "simples" | "destaque") =>
    t === "destaque" ? p.preco_destaque : p.preco_por_imovel
  const semPreco = itens.some((i) => sel.some((p) => precoDe(p, tipos[i.id] ?? "simples") == null))
  const total = itens.reduce(
    (s, i) => s + sel.reduce((a, p) => a + (precoDe(p, tipos[i.id] ?? "simples") ?? 0), 0),
    0
  )

  async function enviar() {
    const sb = portalBrowserClient()
    if (!sb) return
    setMsg("")
    setEnviando(true)
    try {
      const { data: r, error } = await sb.rpc("criar_pedido_publicidade", {
        p_itens: itens.map((i) => ({ imovel: i.id, tipo: tipos[i.id] ?? "simples" })),
        p_portais: escolhidos,
      })
      if (error || !r)
        return setMsg("Não foi possível criar o pedido. Confira se o seu cadastro está aprovado.")
      const ped = r as { id: string; codigo: string; valor: number | null; gratuito: boolean }
      cart.limpar()
      if (ped.gratuito) {
        setMsg(
          `Pedido ${ped.codigo} enviado sem custo (você é parceiro). Agora é só aguardar a aprovação.`
        )
        return
      }
      if (ped.valor == null) {
        setMsg(
          `Pedido ${ped.codigo} registrado. A equipe informa o valor e envia o link de pagamento.`
        )
        return
      }
      const erro = await pagar(ped.id)
      if (erro)
        setMsg(`Pedido ${ped.codigo} criado. ${erro} Você também pode pagar pelo seu painel.`)
    } finally {
      setEnviando(false)
    }
  }

  if (!itens.length)
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">Nenhum imóvel marcado ainda.</p>
        <Link href="/leiloes" className="mt-3 inline-block font-bold text-[var(--brand)]">
          Escolher imóveis na lista de leilões
        </Link>
        {msg ? <p className="mt-3 font-bold">{msg}</p> : null}
      </div>
    )

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="p-3">Imóvel</th>
              <th className="p-3">Tipo de anúncio</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const t = tipos[i.id] ?? "simples"
              const v = sel.reduce((a, p) => a + (precoDe(p, t) ?? 0), 0)
              return (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="p-3">
                    <b>{i.titulo}</b>
                    <div className="text-xs text-slate-500">
                      {i.local} · {i.preco}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
                      {(["simples", "destaque"] as const).map((x) => (
                        <button
                          key={x}
                          type="button"
                          onClick={() => setTipos((s) => ({ ...s, [i.id]: x }))}
                          className={`rounded-md px-3 py-1.5 text-xs font-bold ${t === x ? (x === "destaque" ? "bg-[#C2410C] text-white" : "bg-[var(--brand)] text-white") : ""}`}
                        >
                          {x === "simples" ? "Simples" : "Destaque"}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-right font-bold">{semPreco ? "-" : brl(v)}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => cart.remover(i.id)}
                      className="text-xs font-bold text-red-700"
                    >
                      Tirar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-extrabold">Onde anunciar</legend>
        {portais.map((p) => (
          <label
            key={p.slug}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm"
          >
            <span>
              <input
                type="checkbox"
                checked={escolhidos.includes(p.slug)}
                onChange={(e) =>
                  setEscolhidos((s) =>
                    e.target.checked ? [...s, p.slug] : s.filter((x) => x !== p.slug)
                  )
                }
                className="mr-2"
              />
              <b>{p.nome}</b>
            </span>
            <span className="text-slate-600">
              {p.preco_por_imovel == null ? "sob consulta" : `simples ${brl(p.preco_por_imovel)}`}
              {p.preco_destaque == null ? "" : ` · destaque ${brl(p.preco_destaque)}`} · {p.dias}{" "}
              dias
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 p-5 text-white">
        <div>
          <span className="text-sm opacity-80">Total por {sel[0]?.dias ?? 30} dias</span>
          <p className="text-3xl font-extrabold">{semPreco ? "Sob consulta" : brl(total)}</p>
          <span className="text-xs opacity-80">
            Corretor parceiro ativo não paga. O valor final é calculado pelo sistema.
          </span>
        </div>
        <button
          type="button"
          disabled={enviando || !escolhidos.length}
          onClick={enviar}
          className="rounded-xl bg-white px-6 py-3.5 font-extrabold text-slate-900 disabled:opacity-50"
        >
          {enviando ? "Gerando..." : "Gerar pedido e pagar"}
        </button>
      </div>
      {msg ? <p className="rounded-lg bg-slate-50 p-3 font-bold">{msg}</p> : null}
      <p className="text-xs text-slate-500">
        Quem publica é a nossa equipe, depois do pagamento e da conferência. Você recebe 3 avisos
        antes do fim para renovar; sem renovação, o anúncio sai 2 dias depois do prazo.
      </p>
    </div>
  )
}

/** Pedidos do corretor no painel: pagar, ver prazo, renovar ou não. */
export function MinhaPublicidade() {
  const [pedidos, setPedidos] = React.useState<Pedido[] | null>(null)
  const [avisos, setAvisos] = React.useState<
    { id: number; titulo: string; texto: string; lida: boolean; criado: string }[]
  >([])
  const [msg, setMsg] = React.useState("")
  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: u } = await sb.auth.getUser()
    if (!u.user) return
    const { data: d } = await sb
      .from("anuncio_pedidos")
      .select("*")
      .eq("user_id", u.user.id)
      .order("criado", { ascending: false })
      .limit(50)
    setPedidos((d as Pedido[] | null) ?? [])
    const { data: n } = await sb
      .from("notificacoes")
      .select("id, titulo, texto, lida, criado")
      .eq("lida", false)
      .order("criado", { ascending: false })
      .limit(10)
    setAvisos((n as typeof avisos | null) ?? [])
  }, [])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function renovar(p: Pedido, sim: boolean) {
    const sb = portalBrowserClient()
    if (!sb) return
    setMsg("")
    const { data: r, error } = await sb.rpc("responder_renovacao", {
      p_pedido: p.id,
      p_renovar: sim,
    })
    if (error) return setMsg("Não foi possível registrar a resposta.")
    await sb.from("notificacoes").update({ lida: true }).eq("lida", false)
    if (!sim) {
      setMsg("Certo: o anúncio fica até o fim do prazo e sai 2 dias depois.")
    } else {
      const novo = r as { id: string; valor: number | null; gratuito: boolean }
      if (novo.gratuito || !novo.valor) setMsg("Renovação registrada. Aguarde a aprovação.")
      else {
        const e = await pagar(novo.id)
        if (e) setMsg(e)
      }
    }
    await carregar()
  }

  if (pedidos === null) return null
  return (
    <section
      id="publicidade"
      className="flex scroll-mt-24 flex-col gap-3 rounded-2xl border border-slate-200 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">Minha publicidade</h2>
        <Link
          href="/anunciar"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white"
        >
          Novo anúncio
        </Link>
      </div>
      {avisos.map((a) => (
        <p key={a.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <b>{a.titulo}</b> {a.texto}
        </p>
      ))}
      {msg ? <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold">{msg}</p> : null}
      {pedidos.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum anúncio ainda.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {pedidos.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3 text-sm"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <b>
                Pedido {p.codigo} · {p.imoveis.length} imóve{p.imoveis.length === 1 ? "l" : "is"}
              </b>
              <span className="font-bold">{STATUS[p.status] ?? p.status}</span>
            </div>
            <span className="text-slate-600">
              {p.gratuito
                ? "Sem custo (parceiro)"
                : p.valor != null
                  ? brl(Number(p.valor))
                  : "valor a definir"}
              {p.fim ? ` · no ar até ${data(p.fim)}` : ""}
              {p.itens
                ? ` · ${p.itens.filter((i) => i.tipo === "destaque").length} em destaque`
                : ""}
            </span>
            <div className="flex flex-wrap gap-2">
              {p.status === "aguardando_pagamento" && p.valor ? (
                <button
                  type="button"
                  onClick={async () => {
                    const e = await pagar(p.id)
                    if (e) setMsg(e)
                  }}
                  className="rounded-lg bg-[var(--brand)] px-4 py-2 text-xs font-bold text-white"
                >
                  Pagar agora
                </button>
              ) : null}
              {p.status === "aprovado" && p.renovar === null && p.avisos > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => renovar(p, true)}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
                  >
                    Sim, renovar
                  </button>
                  <button
                    type="button"
                    onClick={() => renovar(p, false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold"
                  >
                    Não renovar
                  </button>
                </>
              ) : null}
              {p.renovar === true ? (
                <span className="text-xs text-emerald-700">Renovação pedida</span>
              ) : null}
              {p.renovar === false ? (
                <span className="text-xs text-slate-500">Não será renovado</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Tabela de preços e aprovação dos pedidos (só o CEO). */
export function PublicidadeGestao() {
  const [portais, setPortais] = React.useState<Portal[]>([])
  const [pedidos, setPedidos] = React.useState<Pedido[]>([])
  const [filtro, setFiltro] = React.useState("pago")
  const [msg, setMsg] = React.useState("")

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: ps } = await sb.from("portais").select("*").order("ordem")
    setPortais((ps as Portal[] | null) ?? [])
    let q = sb.from("anuncio_pedidos").select("*").order("criado", { ascending: false }).limit(200)
    if (filtro !== "todos") q = q.eq("status", filtro)
    const { data: pd } = await q
    setPedidos((pd as Pedido[] | null) ?? [])
  }, [filtro])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function salvarPreco(p: Portal, campo: keyof Portal, valor: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    const v =
      campo === "ativo"
        ? valor === "true"
        : valor.trim() === ""
          ? null
          : Number(valor.replace(/\./g, "").replace(",", "."))
    const { error } = await sb
      .from("portais")
      .update({ [campo]: v })
      .eq("slug", p.slug)
    setMsg(error ? "Não foi possível salvar o preço." : "Tabela atualizada.")
    await carregar()
  }

  async function decidir(p: Pedido, status: "aprovado" | "recusado") {
    const sb = portalBrowserClient()
    if (!sb) return
    const { error } = await sb.from("anuncio_pedidos").update({ status }).eq("id", p.id)
    setMsg(
      error
        ? "Não foi possível atualizar."
        : status === "aprovado"
          ? `Pedido ${p.codigo} publicado.`
          : `Pedido ${p.codigo} recusado.`
    )
    await carregar()
  }

  const campo = "h-9 w-28 rounded-lg border border-slate-300 px-2 text-sm"
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-extrabold">Tabela de preços por imóvel</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="p-3">Canal</th>
                <th className="p-3">Simples (R$)</th>
                <th className="p-3">Destaque (R$)</th>
                <th className="p-3">Dias</th>
                <th className="p-3">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {portais.map((p) => (
                <tr key={p.slug} className="border-t border-slate-100">
                  <td className="p-3 font-bold">{p.nome}</td>
                  <td className="p-3">
                    <input
                      defaultValue={p.preco_por_imovel ?? ""}
                      onBlur={(e) => salvarPreco(p, "preco_por_imovel", e.target.value)}
                      className={campo}
                      inputMode="decimal"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      defaultValue={p.preco_destaque ?? ""}
                      onBlur={(e) => salvarPreco(p, "preco_destaque", e.target.value)}
                      className={campo}
                      inputMode="decimal"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      defaultValue={p.dias}
                      onBlur={(e) => salvarPreco(p, "dias", e.target.value)}
                      className={campo}
                      inputMode="numeric"
                    />
                  </td>
                  <td className="p-3">
                    <select
                      defaultValue={String(p.ativo)}
                      onChange={(e) => salvarPreco(p, "ativo", e.target.value)}
                      className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                    >
                      <option value="true">Sim</option>
                      <option value="false">Não</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Os valores salvam ao sair do campo. Em branco = sob consulta.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xl font-extrabold">Pedidos</h2>
          {(["pago", "aguardando_pagamento", "aprovado", "todos"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${filtro === f ? "bg-slate-900 text-white" : "border border-slate-300"}`}
            >
              {f === "todos" ? "Todos" : STATUS[f]}
            </button>
          ))}
        </div>
        {msg ? <p className="text-sm font-bold">{msg}</p> : null}
        <ul className="flex flex-col gap-2">
          {pedidos.length === 0 ? (
            <li className="text-sm text-slate-500">Nenhum pedido aqui.</li>
          ) : null}
          {pedidos.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm"
            >
              <span>
                <b>{p.codigo}</b> · {p.nome} · {p.imoveis.length} imóveis ·{" "}
                {p.gratuito
                  ? "parceiro (sem custo)"
                  : p.valor != null
                    ? brl(Number(p.valor))
                    : "sob consulta"}{" "}
                · {STATUS[p.status]}
                {p.fim ? ` · até ${data(p.fim)}` : ""}
              </span>
              {p.status === "pago" ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decidir(p, "aprovado")}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    Aprovar e publicar
                  </button>
                  <button
                    type="button"
                    onClick={() => decidir(p, "recusado")}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
                  >
                    Recusar
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <PlanosProprietarioGestao />
    </div>
  )
}

type PlanoProp = {
  id: string
  codigo: string
  valor: number
  dias: number
  status: string
  pago_em: string | null
  pagamento_ref: string | null
  inicio: string | null
  fim: string | null
  criado: string
  imoveis_avulsos: {
    id: string
    titulo: string
    status: string
    contato_nome: string
    contato_telefone: string
  } | null
}

const STATUS_PLANO: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago, esperando aprovação do anúncio",
  ativo: "No site",
  expirado: "Encerrado",
  cancelado: "Cancelado",
}

/** CEO: planos de anúncio dos proprietários (venda direta em /imoveis-a-venda). */
function PlanosProprietarioGestao() {
  const [lista, setLista] = React.useState<PlanoProp[] | null>(null)
  const [filtro, setFiltro] = React.useState("aguardando_pagamento")
  const [msg, setMsg] = React.useState("")

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    let q = sb
      .from("avulsos_planos")
      .select("*, imoveis_avulsos(id, titulo, status, contato_nome, contato_telefone)")
      .order("criado", { ascending: false })
      .limit(200)
    if (filtro !== "todos") q = q.eq("status", filtro)
    const { data, error } = await q
    if (error) setMsg("Planos indisponíveis: o banco precisa da atualização 017.")
    setLista((data as PlanoProp[] | null) ?? [])
  }, [filtro])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function marcarPago(p: PlanoProp) {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: ok, error } = await sb.rpc("ceo_plano_avulso_pago", {
      p_plano: p.id,
      p_ref: "pix/manual",
    })
    setMsg(
      error || !ok
        ? "Não foi possível marcar como pago."
        : `${p.codigo} marcado como pago.${p.imoveis_avulsos?.status === "aprovado" ? " Já está no site." : " Entra no site quando o anúncio for aprovado."}`
    )
    await carregar()
  }

  async function cancelar(p: PlanoProp) {
    const sb = portalBrowserClient()
    if (!sb) return
    const { error } = await sb.from("avulsos_planos").update({ status: "cancelado" }).eq("id", p.id)
    setMsg(error ? "Não foi possível cancelar." : `${p.codigo} cancelado.`)
    await carregar()
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-extrabold">Planos de anúncio dos proprietários</h2>
        <p className="text-sm text-slate-600">
          Venda direta, sem corretor, publicada em{" "}
          <Link href="/imoveis-a-venda" className="font-bold text-[var(--brand)]">
            /imoveis-a-venda
          </Link>
          . O preço e os dias vêm de Configurações. Recebeu por PIX? Marque como pago aqui. A
          aprovação do anúncio continua em Aprovar anúncios.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["aguardando_pagamento", "pago", "ativo", "expirado", "todos"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${filtro === f ? "bg-slate-900 text-white" : "border border-slate-300"}`}
          >
            {f === "todos" ? "Todos" : STATUS_PLANO[f]}
          </button>
        ))}
      </div>
      {msg ? <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold">{msg}</p> : null}
      {lista === null ? <p className="text-slate-600">Carregando...</p> : null}
      {lista && !lista.length ? <p className="text-sm text-slate-500">Nenhum plano aqui.</p> : null}
      <ul className="flex flex-col gap-2">
        {(lista ?? []).map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm"
          >
            <span>
              <b>{p.codigo}</b> · {p.imoveis_avulsos?.titulo ?? "(anúncio removido)"}
              <span className="block text-xs text-slate-500">
                {p.imoveis_avulsos?.contato_nome} · {p.imoveis_avulsos?.contato_telefone} ·{" "}
                {brl(Number(p.valor))} por {p.dias} dias · {STATUS_PLANO[p.status] ?? p.status}
                {p.fim ? ` até ${data(p.fim)}` : ""} · anúncio {p.imoveis_avulsos?.status}
              </span>
            </span>
            {p.status === "aguardando_pagamento" ? (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => marcarPago(p)}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                >
                  Marcar como pago
                </button>
                <button
                  type="button"
                  onClick={() => cancelar(p)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
                >
                  Cancelar
                </button>
              </span>
            ) : p.status === "ativo" ? (
              <button
                type="button"
                onClick={() => cancelar(p)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
              >
                Tirar do site
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
