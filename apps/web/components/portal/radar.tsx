"use client"

import * as React from "react"
import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import { portalBrowserClient } from "@/lib/portal/browser-client"

type Criterios = {
  uf: string
  cidade: string
  tipo: string
  precoMax: string
  descontoMin: string
  financiamento: boolean
  semLeiloeiro: boolean
}

type Item = {
  id: string
  tipo: string | null
  cidade: string | null
  uf: string | null
  bairro: string | null
  preco: number
  avaliacao: number | null
  desconto: number | null
  financiamento: boolean | null
  modalidade: string | null
}

const VAZIO: Criterios = {
  uf: "RJ",
  cidade: "",
  tipo: "",
  precoMax: "",
  descontoMin: "40",
  financiamento: false,
  semLeiloeiro: false,
}

const TIPOS = ["Apartamento", "Casa", "Sobrado", "Terreno", "Sala", "Loja", "Galpão"]
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const titulo = (i: Item) =>
  `${i.tipo ?? "Imóvel"} em ${[i.bairro, i.cidade].filter(Boolean).join(", ")}/${i.uf ?? ""}`

function linkFicha(id: string) {
  return `${window.location.origin}/leiloes/${id}`
}

/** Radar de oportunidades com filtros salvos, seleção e compartilhamento. */
export function Radar({ modo }: { modo: "corretor" | "investidor" | "comprador" }) {
  const [c, setC] = React.useState<Criterios>(VAZIO)
  const [radarId, setRadarId] = React.useState<string | null>(null)
  const [itens, setItens] = React.useState<Item[] | null>(null)
  const [sel, setSel] = React.useState<string[]>([])
  const [link, setLink] = React.useState("")
  const [msg, setMsg] = React.useState("")

  const buscar = React.useCallback(async (cr: Criterios) => {
    const sb = portalBrowserClient()
    if (!sb) return
    let q = sb
      .from("imoveis")
      .select("id,tipo,cidade,uf,bairro,preco,avaliacao,desconto,financiamento,modalidade")
      .eq("ativo", true)
    if (cr.uf) q = q.eq("uf", cr.uf)
    if (cr.cidade.trim()) q = q.ilike("cidade", `%${cr.cidade.trim().replace(/[%_,()]/g, "")}%`)
    if (cr.tipo) q = q.eq("tipo", cr.tipo)
    const max = Number(cr.precoMax.replace(/\D/g, ""))
    if (max > 0) q = q.lte("preco", max)
    const dmin = Number(cr.descontoMin)
    if (dmin > 0) q = q.gte("desconto", dmin)
    if (cr.financiamento) q = q.eq("financiamento", true)
    if (cr.semLeiloeiro) q = q.or("modalidade.ilike.%venda direta%,modalidade.ilike.%venda online%")
    const { data } = await q.order("desconto", { ascending: false, nullsFirst: false }).limit(60)
    setItens((data as Item[] | null) ?? [])
    setSel([])
    setLink("")
  }, [])

  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    void (async () => {
      const { data } = await sb.from("radares").select("id, criterios").order("criado").limit(1)
      const r = (data as { id: string; criterios: Partial<Criterios> }[] | null)?.[0]
      const cr = r ? { ...VAZIO, ...r.criterios } : VAZIO
      if (r) setRadarId(r.id)
      setC(cr)
      await buscar(cr)
    })()
  }, [buscar])

  async function salvarRadar() {
    const sb = portalBrowserClient()
    if (!sb) return
    const r = radarId
      ? await sb.from("radares").update({ criterios: c }).eq("id", radarId).select("id").single()
      : await sb.from("radares").insert({ criterios: c }).select("id").single()
    if (r.error) setMsg("O radar salvo aparece quando o banco estiver atualizado (parte 015).")
    else {
      setRadarId((r.data as { id: string }).id)
      setMsg("Radar salvo. As oportunidades novas aparecem aqui sempre que você entrar.")
    }
    await buscar(c)
  }

  async function gerarLink(): Promise<string | null> {
    const sb = portalBrowserClient()
    if (!sb || !sel.length) return null
    const { data, error } = await sb
      .from("selecoes")
      .insert({ imoveis: sel.slice(0, 60), titulo: "Oportunidades selecionadas para você" })
      .select("codigo")
      .single()
    if (error) {
      setMsg("Não foi possível gerar o link agora.")
      return null
    }
    const url = `${window.location.origin}/r/${(data as { codigo: string }).codigo}`
    setLink(url)
    return url
  }

  async function whatsapp() {
    const url = link || (await gerarLink())
    if (!url) return
    const texto =
      modo === "investidor"
        ? `Olha estas oportunidades de leilão que separei: ${url}`
        : `Separei estas oportunidades de imóveis de leilão para você: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener")
  }

  function salvarHtml() {
    const lista = (itens ?? []).filter((i) => sel.includes(i.id))
    const linhas = lista
      .map(
        (i) =>
          `<tr><td>${titulo(i)}</td><td>${brl(i.preco)}</td><td>${i.avaliacao ? brl(i.avaliacao) : "-"}</td><td>${i.desconto ? Math.round(i.desconto) + "%" : "-"}</td><td><a href="${linkFicha(i.id)}">ficha</a></td></tr>`
      )
      .join("")
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Oportunidades</title><style>body{font-family:Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style><h1>Oportunidades selecionadas</h1><p>Gerado em ${new Date().toLocaleString("pt-BR")}. Confira edital e matrícula antes do lance.</p><table><tr><th>Imóvel</th><th>Preço</th><th>Avaliação</th><th>Desconto</th><th>Link</th></tr>${linhas}</table></html>`
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
    a.download = "oportunidades-vamos-arrematar.html"
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const set =
    (k: keyof Criterios) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setC((x) => ({
        ...x,
        [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value,
      }))

  // Posts do dia: 5 oportunidades que mudam a cada dia, para o corretor divulgar.
  const dia = Math.floor(Date.now() / 86_400_000)
  const posts =
    itens && itens.length
      ? Array.from(
          { length: Math.min(5, itens.length) },
          (_, k) => itens[(dia * 5 + k) % itens.length]!
        )
      : []

  const campo = "h-10 rounded-lg border border-slate-300 px-3 text-sm"
  return (
    <section
      id="radar"
      className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border border-slate-200 p-5"
    >
      <div>
        <h2 className="text-xl font-extrabold">Radar de oportunidades</h2>
        <p className="text-sm text-slate-600">
          Diga onde, quanto e que tipo de imóvel. O radar mostra os maiores descontos que batem com
          o que você procura.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select value={c.uf} onChange={set("uf")} className={`${campo} bg-white`}>
          <option value="">Todo o Brasil</option>
          {BRAZILIAN_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code}
            </option>
          ))}
        </select>
        <input value={c.cidade} onChange={set("cidade")} placeholder="Cidade" className={campo} />
        <select value={c.tipo} onChange={set("tipo")} className={`${campo} bg-white`}>
          <option value="">Qualquer tipo</option>
          {TIPOS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input
          value={c.precoMax}
          onChange={set("precoMax")}
          inputMode="numeric"
          placeholder="Preço até (R$)"
          className={campo}
        />
        <select value={c.descontoMin} onChange={set("descontoMin")} className={`${campo} bg-white`}>
          <option value="">Qualquer desconto</option>
          <option value="30">30% ou mais</option>
          <option value="40">40% ou mais</option>
          <option value="50">50% ou mais</option>
          <option value="60">60% ou mais</option>
        </select>
        <button
          type="button"
          onClick={salvarRadar}
          className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white"
        >
          Salvar e buscar
        </button>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" checked={c.financiamento} onChange={set("financiamento")} /> Só com
          financiamento
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" checked={c.semLeiloeiro} onChange={set("semLeiloeiro")} /> Sem
          comissão de leiloeiro
        </label>
      </div>
      {msg ? <p className="text-sm font-bold">{msg}</p> : null}

      {modo === "corretor" && posts.length ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-[var(--brand-soft)] p-4">
          <b>Seus 5 posts de hoje</b>
          <p className="text-xs text-slate-600">
            Toque em &quot;Criar card&quot;: a arte sai com a sua foto, nome, CRECI e WhatsApp,
            pronta para Instagram, Facebook e WhatsApp.
          </p>
          <ol className="grid gap-2 md:grid-cols-5">
            {posts.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 rounded-xl bg-white p-3 text-sm">
                <b className="leading-tight">{titulo(i)}</b>
                <span>
                  {brl(i.preco)}
                  {i.desconto ? ` · ${Math.round(i.desconto)}% off` : ""}
                </span>
                <Link
                  href={`/corretores/anunciar/${i.id}`}
                  className="mt-auto font-bold text-[var(--brand)]"
                >
                  Criar card →
                </Link>
                <div className="flex gap-2 text-xs">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${titulo(i)} por ${brl(i.preco)}. ${typeof window !== "undefined" ? linkFicha(i.id) : ""}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-emerald-700"
                  >
                    WhatsApp
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== "undefined" ? linkFicha(i.id) : "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-sky-700"
                  >
                    Facebook
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-slate-600">
          {itens === null
            ? "Buscando..."
            : `${itens.length} oportunidade(s) · ${sel.length} selecionada(s)`}
        </span>
        <button
          type="button"
          onClick={() => setSel(itens?.map((i) => i.id) ?? [])}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
        >
          Selecionar todos
        </button>
        <button
          type="button"
          onClick={() => setSel([])}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
        >
          Limpar
        </button>
        <button
          type="button"
          disabled={!sel.length}
          onClick={whatsapp}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          Enviar no WhatsApp
        </button>
        <button
          type="button"
          disabled={!sel.length}
          onClick={() => void gerarLink()}
          className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          {modo === "corretor" ? "Gerar página com a minha cara" : "Gerar link"}
        </button>
        {modo === "investidor" ? (
          <>
            <button
              type="button"
              disabled={!sel.length}
              onClick={salvarHtml}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
            >
              Salvar HTML
            </button>
            <button
              type="button"
              disabled={!sel.length}
              onClick={async () => {
                const u = link || (await gerarLink())
                if (u) window.open(`${u}?imprimir=1`, "_blank")
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
            >
              Gerar PDF
            </button>
          </>
        ) : null}
      </div>
      {link ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold break-all text-[var(--brand)]"
          >
            {link}
          </a>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(link).catch(() => undefined)}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-bold"
          >
            Copiar
          </button>
        </p>
      ) : null}

      <ul className="grid gap-2 md:grid-cols-2">
        {(itens ?? []).map((i) => (
          <li
            key={i.id}
            className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${sel.includes(i.id) ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-slate-200"}`}
          >
            <input
              type="checkbox"
              checked={sel.includes(i.id)}
              onChange={(e) =>
                setSel((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))
              }
              className="mt-1 size-4"
            />
            <div className="flex flex-1 flex-col">
              <Link href={`/leiloes/${i.id}`} className="font-bold hover:text-[var(--brand)]">
                {titulo(i)}
              </Link>
              <span className="text-slate-600">
                {brl(i.preco)}
                {i.avaliacao ? ` · avaliação ${brl(i.avaliacao)}` : ""}
                {i.financiamento ? " · financia" : ""}
              </span>
            </div>
            {i.desconto ? (
              <span className="rounded-lg bg-[#C2410C] px-2 py-1 text-xs font-extrabold text-white">
                {Math.round(i.desconto)}%
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
