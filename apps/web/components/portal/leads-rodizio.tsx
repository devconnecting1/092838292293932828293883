"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

type Lead = {
  id: string
  nome: string
  telefone: string
  email: string | null
  mensagem: string | null
  imovel_id: string | null
  origem: string | null
  status: string
  trava_ate: string | null
  atendido_em: string | null
  cidade: string | null
  criado: string
}

export const TERMO_INDICACAO_VERSAO = "2026-10-v1"

const ETAPAS: [string, string][] = [
  ["contato", "Fiz contato"],
  ["visita", "Visita marcada ou feita"],
  ["proposta", "Proposta enviada"],
  ["vendido", "Vendido"],
  ["perdido", "Cliente desistiu"],
  ["sem_resposta", "Cliente não responde"],
]

function ClienteComFeedback({ lead }: { lead: Lead }) {
  const [etapa, setEtapa] = React.useState("contato")
  const [texto, setTexto] = React.useState("")
  const [hist, setHist] = React.useState<{ etapa: string; texto: string; criado: string }[]>([])
  const [ok, setOk] = React.useState("")
  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data } = await sb
      .from("lead_feedbacks")
      .select("etapa, texto, criado")
      .eq("lead_id", lead.id)
      .order("criado", { ascending: false })
    setHist((data as typeof hist | null) ?? [])
  }, [lead.id])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])
  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    const sb = portalBrowserClient()
    if (!sb) return
    const { error } = await sb
      .from("lead_feedbacks")
      .insert({ lead_id: lead.id, etapa, texto: texto.trim() })
    setOk(error ? "Não foi possível salvar." : "Retorno registrado.")
    if (!error) setTexto("")
    await carregar()
  }
  return (
    <details className="rounded-xl border border-slate-200 p-3 text-sm">
      <summary className="flex cursor-pointer flex-wrap justify-between gap-2">
        <b>{lead.nome}</b>
        <span className="text-slate-500">
          {hist[0] ? ETAPAS.find(([v]) => v === hist[0]?.etapa)?.[1] : "sem retorno ainda"}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <span>
          <a
            href={whats(lead.telefone, lead.nome)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-emerald-700"
          >
            {lead.telefone}
          </a>
          {lead.email ? ` · ${lead.email}` : ""}
        </span>
        {lead.mensagem ? <p className="text-slate-600">{lead.mensagem}</p> : null}
        <form onSubmit={salvar} className="flex flex-col gap-2">
          <select
            value={etapa}
            onChange={(e) => setEtapa(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-2"
          >
            {ETAPAS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            required
            minLength={5}
            rows={2}
            placeholder="O que aconteceu? (obrigatório)"
            className="rounded-lg border border-slate-300 p-2"
          />
          <button className="self-start rounded-lg bg-[var(--brand)] px-4 py-2 font-bold text-white">
            Registrar retorno
          </button>
          {ok ? <span className="font-bold">{ok}</span> : null}
        </form>
        {hist.length ? (
          <ol className="flex flex-col gap-1 text-xs text-slate-600">
            {hist.map((h, i) => (
              <li key={i}>
                {new Date(h.criado).toLocaleString("pt-BR")}:{" "}
                <b>{ETAPAS.find(([v]) => v === h.etapa)?.[1]}</b>, {h.texto}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </details>
  )
}

function restante(ate: string | null, agora: number) {
  if (!ate) return null
  const ms = new Date(ate).getTime() - agora
  if (ms <= 0) return "prazo encerrado"
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, "0")}`
}

function whats(tel: string, nome: string) {
  const d = tel.replace(/\D/g, "")
  const num = d.length >= 10 && !d.startsWith("55") ? `55${d}` : d
  const texto = `Olá, ${nome.split(" ")[0]}! Sou corretor do Vamos Arrematar e vi o seu interesse no imóvel. Posso te ajudar?`
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`
}

/**
 * Leads do rodízio para o corretor: quem chega tem 30 minutos para falar com o
 * cliente e marcar "Já falei". Se não marcar, o lead vai para o próximo
 * corretor mais perto, e some desta lista.
 */
export function LeadsRodizio({ uid }: { uid: string }) {
  const [leads, setLeads] = React.useState<Lead[] | null>(null)
  const [agora, setAgora] = React.useState(() => Date.now())
  const [msg, setMsg] = React.useState("")
  const [termo, setTermo] = React.useState<Record<string, boolean>>({})

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    await sb.rpc("redistribuir_leads_vencidos")
    const { data } = await sb
      .from("leads")
      .select(
        "id,nome,telefone,email,mensagem,imovel_id,origem,status,trava_ate,atendido_em,cidade,criado"
      )
      .eq("corretor_id", uid)
      .order("criado", { ascending: false })
      .limit(50)
    setLeads((data as Lead[] | null) ?? [])
  }, [uid])

  React.useEffect(() => {
    const primeira = setTimeout(carregar, 0)
    const relogio = setInterval(() => setAgora(Date.now()), 1000)
    const busca = setInterval(carregar, 60_000)
    return () => {
      clearTimeout(primeira)
      clearInterval(relogio)
      clearInterval(busca)
    }
  }, [carregar])

  async function aceitar(id: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    setMsg("")
    const { data, error } = await sb.rpc("aceitar_lead", {
      p_lead: id,
      p_versao: TERMO_INDICACAO_VERSAO,
    })
    setMsg(
      error || !data
        ? "O prazo deste lead acabou e ele voltou para a central."
        : "Termo aceito. O cliente é da plataforma e agora está com você: registre cada passo do atendimento."
    )
    await carregar()
  }

  async function devolver(id: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    setMsg("")
    await sb.rpc("devolver_lead", { p_lead: id })
    setMsg("Lead devolvido para a central.")
    await carregar()
  }

  if (leads === null) return null
  const novos = leads.filter((l) => !l.atendido_em)
  const meus = leads.filter((l) => l.atendido_em)

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-5">
      <div>
        <h2 className="text-xl font-extrabold">Leads para você</h2>
        <p className="text-sm text-slate-600">
          A central encaminha clientes para o parceiro mais perto. Você tem 30 minutos para aceitar
          o termo de indicação e atender. Se o prazo passar, o cliente volta para a central.
        </p>
      </div>
      {msg ? <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold">{msg}</p> : null}
      {novos.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum lead esperando agora.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {novos.map((l) => {
            const t = restante(l.trava_ate, agora)
            const urgente = l.trava_ate && new Date(l.trava_ate).getTime() - agora < 10 * 60000
            return (
              <li
                key={l.id}
                className="flex flex-col gap-2 rounded-xl border-2 border-[var(--brand)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-lg font-extrabold">{l.nome}</span>
                  {t ? (
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-extrabold tabular-nums ${urgente ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}
                    >
                      {t}
                    </span>
                  ) : null}
                </div>
                <span className="text-sm text-slate-700">
                  {l.cidade ? `${l.cidade} · ` : ""}
                  {l.origem ? `veio de ${l.origem}` : "veio do portal"}
                </span>
                <p className="text-xs text-slate-500">
                  Telefone e e-mail aparecem depois que você aceitar o termo.
                </p>
                {l.imovel_id ? (
                  <Link
                    href={`/leiloes/${l.imovel_id}`}
                    className="text-sm font-bold text-[var(--brand)]"
                  >
                    Ver o imóvel
                  </Link>
                ) : null}
                <label className="block text-xs leading-relaxed text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!termo[l.id]}
                    onChange={(e) => setTermo((t) => ({ ...t, [l.id]: e.target.checked }))}
                    className="mr-2 inline size-4 align-[-3px]"
                  />
                  Li e aceito o{" "}
                  <Link href="/termo-indicacao" target="_blank" className="font-bold underline">
                    Termo de Indicação
                  </Link>
                  : o cliente é da plataforma, vou dar retorno de cada etapa e não vou negociar por
                  fora.
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!termo[l.id]}
                    onClick={() => aceitar(l.id)}
                    className="rounded-lg bg-[var(--brand)] py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Aceitar e atender
                  </button>
                  <button
                    type="button"
                    onClick={() => devolver(l.id)}
                    className="rounded-lg border border-slate-300 py-2.5 text-sm font-bold"
                  >
                    Não posso atender
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {meus.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-extrabold">Meus clientes ({meus.length})</h3>
          {meus.map((l) => (
            <ClienteComFeedback key={l.id} lead={l} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** Onde o corretor atende: os bairros dão prioridade no rodízio da própria cidade. */
export function AreaAtendimento({
  uid,
  cidade,
  uf,
  bairros,
  recebe,
}: {
  uid: string
  cidade: string | null
  uf: string | null
  bairros: string[]
  recebe: boolean
}) {
  const [status, setStatus] = React.useState("")
  async function salvar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return
    const lista = String(fd.get("bairros") ?? "")
      .split(/[,;\n]/)
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 30)
    const { error } = await sb
      .from("perfis")
      .update({ bairros_atuacao: lista, recebe_leads: fd.get("recebe") === "on" })
      .eq("user_id", uid)
    setStatus(error ? "Não foi possível salvar." : "Salvo.")
  }
  return (
    <form action={salvar} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5">
      <h2 className="text-xl font-extrabold">Minha área de atendimento</h2>
      <p className="text-sm text-slate-600">
        Você recebe leads de {cidade ?? "sua cidade"}
        {uf ? `/${uf}` : ""} primeiro. Se ninguém da cidade atender, o lead vai para as cidades
        vizinhas do mesmo estado, da mais perto para a mais longe.
      </p>
      <label className="flex flex-col gap-1 text-sm font-bold">
        Bairros em que você atende (separe por vírgula)
        <textarea
          name="bairros"
          rows={2}
          defaultValue={bairros.join(", ")}
          placeholder="Centro, Moquetá, Jardim Iguaçu"
          className="rounded-lg border border-slate-300 p-3 font-normal"
        />
      </label>
      <label className="block text-sm">
        <input
          type="checkbox"
          name="recebe"
          defaultChecked={recebe}
          className="mr-2 inline size-4 align-[-3px]"
        />
        Quero receber leads do rodízio
      </label>
      <div className="flex items-center gap-3">
        <button className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white">
          Salvar
        </button>
        {status ? <span className="text-sm font-bold">{status}</span> : null}
      </div>
    </form>
  )
}
