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

  async function acao(fn: "assumir_lead" | "devolver_lead", id: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    setMsg("")
    const { data, error } = await sb.rpc(fn, { p_lead: id })
    if (error || !data)
      setMsg("O prazo deste lead já acabou e ele foi passado para outro corretor.")
    else if (fn === "assumir_lead") setMsg("Lead confirmado. Agora ele é seu.")
    else setMsg("Lead passado para o próximo corretor.")
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
          Você tem 30 minutos para falar com o cliente e marcar &quot;Já falei&quot;. Depois disso o
          lead vai para o próximo corretor mais perto.
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
                  {l.telefone}
                  {l.email ? ` · ${l.email}` : ""}
                  {l.origem ? ` · veio de ${l.origem}` : ""}
                </span>
                {l.mensagem ? <p className="text-sm text-slate-600">{l.mensagem}</p> : null}
                {l.imovel_id ? (
                  <Link
                    href={`/leiloes/${l.imovel_id}`}
                    className="text-sm font-bold text-[var(--brand)]"
                  >
                    Ver o imóvel
                  </Link>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  <a
                    href={whats(l.telefone, l.nome)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-emerald-600 py-2.5 text-center text-sm font-bold text-white"
                  >
                    Chamar no WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => acao("assumir_lead", l.id)}
                    className="rounded-lg bg-[var(--brand)] py-2.5 text-sm font-bold text-white"
                  >
                    Já falei com o cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => acao("devolver_lead", l.id)}
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
        <details>
          <summary className="cursor-pointer text-sm font-bold">
            Meus clientes ({meus.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {meus.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2"
              >
                <span className="font-bold">{l.nome}</span>
                <a
                  href={whats(l.telefone, l.nome)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700"
                >
                  {l.telefone}
                </a>
              </li>
            ))}
          </ul>
        </details>
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
