"use client"

import * as React from "react"

import { portalBrowserClient } from "@/lib/portal/browser-client"

/* CRM interno de cada usuário: tarefas em Kanban, clientes por etapa e a própria agenda Google. */

type Tarefa = {
  id: string
  titulo: string
  prioridade?: "normal" | "alta" | "urgente"
  detalhe: string | null
  coluna: "a_fazer" | "fazendo" | "feito"
  etiqueta: string | null
  prazo: string | null
  ordem: number
}

const COLUNAS: [Tarefa["coluna"], string][] = [
  ["a_fazer", "A fazer"],
  ["fazendo", "Fazendo"],
  ["feito", "Feito"],
]

const ETIQUETAS = ["Cliente", "Visita", "Documentos", "Leilão", "Financeiro", "Pessoal"]

const COR: Record<string, string> = {
  Cliente: "bg-sky-100 text-sky-900",
  Visita: "bg-emerald-100 text-emerald-900",
  Documentos: "bg-amber-100 text-amber-900",
  Leilão: "bg-orange-100 text-orange-900",
  Financeiro: "bg-violet-100 text-violet-900",
  Pessoal: "bg-slate-100 text-slate-800",
}

/** Link "adicionar ao Google Agenda" (abre o Google já preenchido, na conta de quem clicar). */
function linkGoogleAgenda(t: Tarefa) {
  const ini = t.prazo ? new Date(t.prazo) : new Date(Date.now() + 3600_000)
  const fim = new Date(ini.getTime() + 3600_000)
  const f = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "")
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: t.titulo,
    details: t.detalhe ?? "",
    dates: `${f(ini)}/${f(fim)}`,
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

function KanbanTarefas() {
  const [tarefas, setTarefas] = React.useState<Tarefa[] | null>(null)
  const [arrastando, setArrastando] = React.useState<string | null>(null)
  const [filtro, setFiltro] = React.useState("")
  const [erro, setErro] = React.useState("")

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data, error } = await sb.from("tarefas").select("*").order("ordem").order("criado")
    if (error) setErro("O quadro de tarefas aparece quando o banco estiver atualizado (parte 014).")
    setTarefas((data as Tarefa[] | null) ?? [])
  }, [])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function criar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return
    const prazo = String(fd.get("prazo") ?? "")
    await sb.from("tarefas").insert({
      titulo: String(fd.get("titulo") ?? "").trim(),
      detalhe: String(fd.get("detalhe") ?? "").trim() || null,
      etiqueta: String(fd.get("etiqueta") ?? "") || null,
      prazo: prazo ? new Date(prazo).toISOString() : null,
      prioridade: String(fd.get("prioridade") ?? "normal"),
    })
    await carregar()
  }

  async function mover(id: string, coluna: Tarefa["coluna"]) {
    const sb = portalBrowserClient()
    if (!sb) return
    setTarefas((ts) => ts?.map((t) => (t.id === id ? { ...t, coluna } : t)) ?? null)
    await sb.from("tarefas").update({ coluna, atualizado: new Date().toISOString() }).eq("id", id)
  }

  async function apagar(id: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    await sb.from("tarefas").delete().eq("id", id)
    await carregar()
  }

  const f = filtro.trim().toLowerCase()
  const visiveis = (tarefas ?? []).filter(
    (t) => !f || `${t.titulo} ${t.detalhe ?? ""} ${t.etiqueta ?? ""}`.toLowerCase().includes(f)
  )
  const atrasada = (t: Tarefa) =>
    t.coluna !== "feito" && t.prazo && new Date(t.prazo).getTime() < Date.now()

  return (
    <div className="flex flex-col gap-4">
      <form
        action={criar}
        className="grid gap-2 rounded-2xl border border-slate-200 p-4 sm:grid-cols-[1fr_140px_130px_200px_auto]"
      >
        <input
          name="titulo"
          required
          minLength={2}
          placeholder="Nova tarefa (ex.: ligar para o cliente)"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <select
          name="etiqueta"
          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">Etiqueta</option>
          {ETIQUETAS.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <select
          name="prioridade"
          defaultValue="normal"
          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="normal">Normal</option>
          <option value="alta">Alta</option>
          <option value="urgente">Urgente</option>
        </select>
        <input
          name="prazo"
          type="datetime-local"
          title="Prazo: o sistema avisa antes de vencer e quando atrasar"
          className="h-10 rounded-lg border border-slate-300 px-2 text-sm"
        />
        <button className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white">
          Adicionar
        </button>
        <input
          name="detalhe"
          placeholder="Detalhe (opcional)"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm sm:col-span-5"
        />
      </form>
      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar tarefa, cliente ou etiqueta"
        className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
      />
      {erro ? <p className="text-sm text-slate-500">{erro}</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        {COLUNAS.map(([col, nome]) => (
          <div
            key={col}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => arrastando && mover(arrastando, col)}
            className="flex min-h-40 flex-col gap-2 rounded-2xl bg-slate-50 p-3"
          >
            <b className="text-sm">
              {nome} ({visiveis.filter((t) => t.coluna === col).length})
            </b>
            {visiveis
              .filter((t) => t.coluna === col)
              .map((t) => (
                <article
                  key={t.id}
                  draggable
                  onDragStart={() => setArrastando(t.id)}
                  onDragEnd={() => setArrastando(null)}
                  className={`flex cursor-grab flex-col gap-1 rounded-xl border bg-white p-3 text-sm shadow-sm ${atrasada(t) ? "border-red-300" : "border-slate-200"}`}
                >
                  {t.etiqueta ? (
                    <span
                      className={`self-start rounded px-2 py-0.5 text-[11px] font-bold ${COR[t.etiqueta] ?? COR.Pessoal}`}
                    >
                      {t.etiqueta}
                    </span>
                  ) : null}
                  <b>
                    {t.prioridade === "urgente" ? (
                      <span className="mr-1 rounded bg-red-600 px-1.5 text-[11px] text-white">
                        URGENTE
                      </span>
                    ) : t.prioridade === "alta" ? (
                      <span className="mr-1 rounded bg-amber-500 px-1.5 text-[11px] text-white">
                        ALTA
                      </span>
                    ) : null}
                    {t.titulo}
                  </b>
                  {t.detalhe ? <span className="text-slate-600">{t.detalhe}</span> : null}
                  {t.prazo ? (
                    <span
                      className={`text-xs ${atrasada(t) ? "font-bold text-red-700" : "text-slate-500"}`}
                    >
                      {atrasada(t) ? "Atrasada: " : "Prazo: "}
                      {new Date(t.prazo).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {COLUNAS.filter(([c]) => c !== col).map(([c, n]) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => mover(t.id, c)}
                        className="font-bold text-[var(--brand)]"
                      >
                        → {n}
                      </button>
                    ))}
                    <a
                      href={linkGoogleAgenda(t)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-emerald-700"
                    >
                      Google Agenda
                    </a>
                    <button type="button" onClick={() => apagar(t.id)} className="text-red-700">
                      Apagar
                    </button>
                  </div>
                </article>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function MinhaAgenda() {
  const [agenda, setAgenda] = React.useState<string | null | undefined>(undefined)
  const [uid, setUid] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState("")
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    void (async () => {
      const { data: u } = await sb.auth.getUser()
      if (!u.user) return setAgenda(null)
      setUid(u.user.id)
      const { data } = await sb
        .from("perfis")
        .select("agenda_google, email")
        .eq("user_id", u.user.id)
        .maybeSingle()
      const p = data as { agenda_google?: string | null } | null
      setAgenda(p?.agenda_google ?? null)
    })()
  }, [])

  async function salvar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb || !uid) return
    const v =
      String(fd.get("agenda") ?? "")
        .trim()
        .slice(0, 200) || null
    const { error } = await sb.from("perfis").update({ agenda_google: v }).eq("user_id", uid)
    setMsg(error ? "Não foi possível salvar." : "Agenda salva.")
    if (!error) setAgenda(v)
  }

  if (agenda === undefined) return <p className="text-slate-600">Carregando...</p>
  return (
    <div className="flex flex-col gap-3">
      <form action={salvar} className="flex flex-wrap gap-2">
        <input
          name="agenda"
          defaultValue={agenda ?? ""}
          placeholder="Seu e-mail do Google (ou o ID da agenda)"
          className="h-10 min-w-[280px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <button className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white">
          Salvar
        </button>
        <a
          href="https://calendar.google.com/calendar/u/0/r"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-bold"
        >
          Abrir o Google Agenda
        </a>
      </form>
      {msg ? <p className="text-sm font-bold">{msg}</p> : null}
      {agenda ? (
        <iframe
          title="Minha agenda Google"
          src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(agenda)}&ctz=America%2FSao_Paulo&mode=WEEK&showTitle=0`}
          className="h-[560px] w-full rounded-2xl border border-slate-200"
        />
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">
        A agenda é sua e só aparece no seu painel. Para ela aparecer aqui, entre no Google Agenda
        com a mesma conta e mantenha a sessão aberta neste navegador. Cada tarefa do quadro tem o
        botão &quot;Google Agenda&quot;, que cria o compromisso direto na sua agenda.
      </p>
    </div>
  )
}

type LeadEtapa = {
  id: string
  nome: string
  telefone: string
  etapa: string | null
  atendido_em: string | null
}

const ETAPAS: [string, string][] = [
  ["contato", "Contato"],
  ["visita", "Visita"],
  ["proposta", "Proposta"],
  ["vendido", "Vendido"],
  ["perdido", "Perdido"],
]

function KanbanClientes() {
  const [leads, setLeads] = React.useState<LeadEtapa[] | null>(null)
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    void (async () => {
      const { data: u } = await sb.auth.getUser()
      if (!u.user) return setLeads([])
      const { data } = await sb
        .from("leads")
        .select("id, nome, telefone, etapa, atendido_em")
        .eq("corretor_id", u.user.id)
        .not("atendido_em", "is", null)
        .order("atendido_em", { ascending: false })
        .limit(200)
      setLeads((data as LeadEtapa[] | null) ?? [])
    })()
  }, [])
  if (leads === null) return <p className="text-slate-600">Carregando...</p>
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-600">
        Seus clientes recebidos pela central, por etapa. Para mudar a etapa, registre o retorno em
        &quot;Leads para você&quot;.
      </p>
      <div className="grid gap-3 md:grid-cols-5">
        {ETAPAS.map(([e, n]) => (
          <div key={e} className="flex min-h-32 flex-col gap-2 rounded-2xl bg-slate-50 p-3">
            <b className="text-sm">
              {n} ({leads.filter((l) => (l.etapa ?? "contato") === e).length})
            </b>
            {leads
              .filter((l) => (l.etapa ?? "contato") === e)
              .map((l) => (
                <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-2 text-sm">
                  <b>{l.nome}</b>
                  <div className="text-xs text-slate-500">{l.telefone}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const ABAS = [
  ["tarefas", "Tarefas"],
  ["clientes", "Clientes"],
  ["agenda", "Minha agenda"],
] as const

/** Área "Meu CRM" do painel. `semClientes` para quem não recebe leads (investidor, equipe). */
export function MeuCrm({ semClientes = false }: { semClientes?: boolean }) {
  const [aba, setAba] = React.useState<(typeof ABAS)[number][0]>("tarefas")
  return (
    <section
      id="crm"
      className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border border-slate-200 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">Meu CRM</h2>
        <div className="flex flex-wrap gap-2">
          {ABAS.filter(([v]) => !(semClientes && v === "clientes")).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setAba(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold ${aba === v ? "bg-slate-900 text-white" : "border border-slate-300"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {aba === "tarefas" ? <KanbanTarefas /> : null}
      {aba === "clientes" ? <KanbanClientes /> : null}
      {aba === "agenda" ? <MinhaAgenda /> : null}
    </section>
  )
}
