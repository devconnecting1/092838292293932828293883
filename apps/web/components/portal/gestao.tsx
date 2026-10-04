"use client"

import * as React from "react"
import Link from "next/link"

import { EditarPerfil } from "@/components/portal/configuracoes"
import { portalBrowserClient } from "@/lib/portal/browser-client"
import { PLANOS } from "@/lib/portal/planos"
import { useConfigPortal, usePlanos } from "@/lib/portal/use-config"

/* ------------------------------------------------------------------ acesso */

type Papel = "carregando" | "fora" | "ceo" | "atendente"

export function useEquipe() {
  const [papel, setPapel] = React.useState<Papel>("carregando")
  const [uid, setUid] = React.useState<string | null>(null)
  const [nome, setNome] = React.useState("")
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) {
      const t = setTimeout(() => setPapel("fora"), 0)
      return () => clearTimeout(t)
    }
    void (async () => {
      const { data: u } = await sb.auth.getUser()
      if (!u.user) return setPapel("fora")
      const { data } = await sb
        .from("perfis")
        .select("perfil, nome")
        .eq("user_id", u.user.id)
        .maybeSingle()
      const p = data as { perfil?: string; nome?: string } | null
      setUid(u.user.id)
      setNome(p?.nome ?? "")
      setPapel(p?.perfil === "admin" ? "ceo" : p?.perfil === "atendente" ? "atendente" : "fora")
    })()
  }, [])
  return { papel, uid, nome }
}

const ABAS: [string, string, boolean][] = [
  ["/gestao", "Painel", false],
  ["/gestao/clientes", "Clientes", false],
  ["/gestao/leads", "Leads", true],
  ["/gestao/publicidade", "Publicidade", true],
  ["/gestao/chamados", "Chamados", false],
  ["/gestao/crm", "Meu CRM", false],
  ["/gestao/equipe", "Equipe", true],
  ["/gestao/auditoria", "Auditoria", true],
  ["/gestao/configuracoes", "Configurações", true],
]

export function GestaoShell({ ativo, children }: { ativo: string; children: React.ReactNode }) {
  const { papel, nome } = useEquipe()
  if (papel === "carregando")
    return <p className="p-10 text-center text-slate-600">Carregando...</p>
  if (papel === "fora")
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="font-bold">Área restrita à equipe.</p>
        <Link
          href="/corretores/entrar?volta=/gestao"
          className="mt-3 inline-block font-bold text-[var(--brand)]"
        >
          Entrar
        </Link>
      </div>
    )
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
            {papel === "ceo" ? "Administração geral · CEO" : "Equipe de atendimento"}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Olá, {nome.split(" ")[0] || "equipe"}
          </h1>
        </div>
      </div>
      <nav className="flex flex-wrap gap-2">
        {ABAS.filter(([, , soCeo]) => !soCeo || papel === "ceo").map(([href, rotulo]) => (
          <Link
            key={href}
            href={href}
            className={`rounded-full px-4 py-2 text-sm font-bold ${ativo === href ? "bg-[var(--brand)] text-white" : "border border-slate-300"}`}
          >
            {rotulo}
          </Link>
        ))}
        {papel === "ceo" ? (
          <>
            <Link
              href="/corretores/aprovar"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold"
            >
              Aprovar corretores
            </Link>
            <Link
              href="/corretores/aprovar-anuncios"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold"
            >
              Aprovar anúncios
            </Link>
            <Link
              href="/corretores/importar"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold"
            >
              Atualizar imóveis
            </Link>
          </>
        ) : null}
      </nav>
      <PapelContexto.Provider value={papel}>{children}</PapelContexto.Provider>
    </div>
  )
}

const PapelContexto = React.createContext<Papel>("carregando")
export const usePapel = () => React.useContext(PapelContexto)

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const dataHora = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-"

/* ------------------------------------------------------------------ painel */

type Resumo = {
  assinantes: Record<string, number>
  parceiros: number
  clientes: Record<string, number>
  leads_mes: number
  leads_atendidos_mes: number
  avulsos: Record<string, number>
  chamados_abertos: number
}

export function PainelGestao() {
  const papel = usePapel()
  const [r, setR] = React.useState<Resumo | null>(null)
  const [abertos, setAbertos] = React.useState<number | null>(null)
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    void (async () => {
      if (papel === "ceo") {
        const { data } = await sb.rpc("financeiro_resumo")
        setR((data as Resumo | null) ?? null)
      }
      const { count } = await sb
        .from("chamados")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(resolvido,fechado)")
      setAbertos(count ?? 0)
    })()
  }, [papel])

  const planos = usePlanos()
  const receita = r ? planos.reduce((s, p) => s + (r.assinantes[p.id] ?? 0) * p.mensal, 0) : null

  const Card = ({ t, v, d }: { t: string; v: string; d?: string }) => (
    <div className="rounded-2xl border border-slate-200 p-5">
      <span className="text-sm text-slate-500">{t}</span>
      <p className="text-3xl font-extrabold tracking-tight">{v}</p>
      {d ? <span className="text-xs text-slate-500">{d}</span> : null}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card t="Chamados em aberto" v={abertos === null ? "..." : String(abertos)} />
        {papel === "ceo" && r ? (
          <>
            <Card
              t="Receita recorrente estimada"
              v={brl(receita ?? 0)}
              d="Assinantes ativos x preço mensal de tabela"
            />
            <Card
              t="Leads no mês"
              v={String(r.leads_mes)}
              d={`${r.leads_atendidos_mes} atendidos no prazo`}
            />
            <Card t="Corretores parceiros" v={String(r.parceiros)} d="Sem mensalidade" />
          </>
        ) : null}
      </div>
      {papel === "ceo" && r ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 p-5 text-sm">
            <b>Assinantes por plano</b>
            {planos.map((p) => (
              <p key={p.id} className="flex justify-between border-b border-slate-100 py-1.5">
                <span>{p.nome}</span>
                <b>{r.assinantes[p.id] ?? 0}</b>
              </p>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 p-5 text-sm">
            <b>Cadastros por categoria</b>
            {Object.entries(r.clientes).map(([k, v]) => (
              <p key={k} className="flex justify-between border-b border-slate-100 py-1.5">
                <span className="capitalize">{k}</span>
                <b>{v}</b>
              </p>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 p-5 text-sm">
            <b>Imóveis avulsos</b>
            {Object.entries(r.avulsos).length ? (
              Object.entries(r.avulsos).map(([k, v]) => (
                <p key={k} className="flex justify-between border-b border-slate-100 py-1.5">
                  <span className="capitalize">{k}</span>
                  <b>{v}</b>
                </p>
              ))
            ) : (
              <p className="py-1.5 text-slate-500">Nenhum ainda.</p>
            )}
          </div>
        </div>
      ) : null}
      {papel === "ceo" && !r ? (
        <p className="text-sm text-slate-500">
          O resumo financeiro aparece quando o banco estiver atualizado (parte 009).
        </p>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- clientes */

type Cliente = {
  user_id: string
  nome: string | null
  email: string | null
  whatsapp: string | null
  perfil: string
  cidade: string | null
  uf: string | null
  creci: string | null
  creci_uf: string | null
  status: string | null
  plano: string | null
  plano_ate: string | null
  parceiro: boolean
  criado: string
}

const CATEGORIAS: [string, string][] = [
  ["corretor", "Corretores"],
  ["imobiliaria", "Imobiliárias"],
  ["investidor", "Investidores"],
  ["proprietario", "Proprietários"],
  ["comprador", "Compradores"],
  ["", "Todos"],
]

function cobranca(c: Cliente) {
  if (c.parceiro && c.status === "aprovado") return "Parceiro (sem mensalidade)"
  if (c.plano && c.plano !== "gratis" && c.plano_ate) {
    const ativo = new Date(c.plano_ate).getTime() > Date.now()
    return `${PLANOS.find((p) => p.id === c.plano)?.nome ?? c.plano} · ${ativo ? "em dia até" : "vencido em"} ${new Date(c.plano_ate).toLocaleDateString("pt-BR")}`
  }
  return "Grátis"
}

export function ClientesGestao() {
  const papel = usePapel()
  const [tipo, setTipo] = React.useState("corretor")
  const [busca, setBusca] = React.useState("")
  const [lista, setLista] = React.useState<Cliente[] | null>(null)
  const [msg, setMsg] = React.useState("")
  const [editando, setEditando] = React.useState<Cliente | null>(null)

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data, error } = await sb.rpc("equipe_clientes", {
      p_tipo: tipo || null,
      p_busca: busca.trim() || null,
    })
    if (error) setMsg("Lista indisponível: o banco precisa da atualização 009.")
    setLista((data as Cliente[] | null) ?? [])
  }, [tipo, busca])

  React.useEffect(() => {
    const t = setTimeout(carregar, 250)
    return () => clearTimeout(t)
  }, [carregar])

  async function trocarSenha(c: Cliente) {
    const sb = portalBrowserClient()
    if (!sb || !c.email) return setMsg("Esse cliente não tem e-mail cadastrado.")
    const { error } = await sb.auth.resetPasswordForEmail(c.email, {
      redirectTo: `${window.location.origin}/corretores/nova-senha`,
    })
    await sb.rpc("registrar_acao", {
      p_acao: "enviou troca de senha",
      p_alvo: c.email,
      p_detalhe: c.nome,
    })
    setMsg(
      error ? "Não foi possível enviar agora." : `Link de troca de senha enviado para ${c.email}.`
    )
  }

  async function fechamento(c: Cliente) {
    const sb = portalBrowserClient()
    if (!sb) return
    const { error } = await sb.rpc("registrar_fechamento", {
      p_user: c.user_id,
      p_venda: true,
      p_nota: "venda registrada pelo CEO",
    })
    setMsg(
      error
        ? "Não foi possível registrar."
        : `Venda registrada: ${c.nome} ganhou mais 1 ano grátis.`
    )
  }

  async function mudarCategoria(c: Cliente, novo: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    const { error } = await sb.from("perfis").update({ perfil: novo }).eq("user_id", c.user_id)
    setMsg(error ? "Não foi possível mudar a categoria." : `${c.nome} agora é ${novo}.`)
    await carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {CATEGORIAS.map(([v, l]) => (
          <button
            key={l}
            type="button"
            onClick={() => setTipo(v)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${tipo === v ? "bg-slate-900 text-white" : "border border-slate-300"}`}
          >
            {l}
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, e-mail, WhatsApp ou CRECI"
          className="h-10 min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3"
        />
      </div>
      {msg ? <p className="rounded-lg bg-slate-50 p-3 text-sm font-bold">{msg}</p> : null}
      {lista === null ? <p className="text-slate-600">Carregando...</p> : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="p-3">Nome</th>
              <th className="p-3">Contato</th>
              <th className="p-3">Local</th>
              <th className="p-3">Cadastro</th>
              <th className="p-3">Cobrança</th>
              <th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(lista ?? []).map((c) => (
              <tr key={c.user_id} className="border-t border-slate-100 align-top">
                <td className="p-3">
                  <b>{c.nome ?? "(sem nome)"}</b>
                  <div className="text-xs text-slate-500">
                    {c.perfil}
                    {c.creci ? ` · CRECI ${c.creci}/${c.creci_uf ?? ""}` : ""}
                  </div>
                </td>
                <td className="p-3">
                  {c.email}
                  <div className="text-xs">{c.whatsapp}</div>
                </td>
                <td className="p-3">{[c.cidade, c.uf].filter(Boolean).join("/")}</td>
                <td className="p-3">
                  {c.status ?? "-"}
                  <div className="text-xs text-slate-500">
                    {new Date(c.criado).toLocaleDateString("pt-BR")}
                  </div>
                </td>
                <td className="p-3 text-xs">{cobranca(c)}</td>
                <td className="p-3">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => trocarSenha(c)}
                      className="text-left text-xs font-bold text-[var(--brand)]"
                    >
                      Enviar troca de senha
                    </button>
                    <Link
                      href={`/gestao/chamados?novo=1&cliente=${c.user_id}&nome=${encodeURIComponent(c.nome ?? "")}&contato=${encodeURIComponent(c.email ?? c.whatsapp ?? "")}`}
                      className="text-xs font-bold text-[var(--brand)]"
                    >
                      Abrir chamado
                    </Link>
                    {papel === "ceo" && (c.perfil === "corretor" || c.perfil === "imobiliaria") ? (
                      <button
                        type="button"
                        onClick={() => fechamento(c)}
                        className="text-left text-xs font-bold text-emerald-700"
                      >
                        Registrar venda (+1 ano grátis)
                      </button>
                    ) : null}
                    {papel === "ceo" ? (
                      <button
                        type="button"
                        onClick={() => setEditando(c)}
                        className="text-left text-xs font-bold text-slate-900 underline"
                      >
                        Editar dados
                      </button>
                    ) : null}
                    {papel === "ceo" ? (
                      <select
                        value=""
                        onChange={(e) => e.target.value && mudarCategoria(c, e.target.value)}
                        className="mt-1 rounded border border-slate-300 bg-white text-xs"
                      >
                        <option value="">Mudar categoria...</option>
                        <option value="corretor">Corretor</option>
                        <option value="imobiliaria">Imobiliária</option>
                        <option value="investidor">Investidor</option>
                        <option value="proprietario">Proprietário</option>
                      </select>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {papel === "ceo"
          ? "Como CEO, você edita qualquer dado em Editar dados. Toda ação fica registrada na auditoria."
          : "Dados bancários, PIX e documentos não aparecem aqui. Toda ação fica registrada na auditoria."}
      </p>
      {editando ? (
        <EditarPerfil
          userId={editando.user_id}
          onFechar={(salvou) => {
            setEditando(null)
            if (salvou) {
              setMsg(`Dados de ${editando.nome ?? "cliente"} atualizados.`)
              void carregar()
            }
          }}
        />
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- chamados */

type Chamado = {
  id: string
  protocolo: string
  cliente_id: string | null
  cliente_nome: string
  cliente_contato: string | null
  assunto: string
  categoria: string
  canal: string
  status: string
  responsavel_id: string | null
  criado: string
  atualizado: string
  resolvido_em: string | null
}

type Mensagem = {
  id: number
  autor_nome: string | null
  da_equipe: boolean
  interna: boolean
  texto: string
  email_enviado: boolean
  criado: string
}

const STATUS: Record<string, string> = {
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando o cliente",
  resolvido: "Resolvido",
  fechado: "Fechado",
}
const CATS = [
  "duvida",
  "acesso",
  "cobranca",
  "anuncio",
  "leilao",
  "parceria",
  "reclamacao",
  "outro",
]

function Conversa({
  chamado,
  equipe,
  aoMudar,
}: {
  chamado: Chamado
  equipe: boolean
  aoMudar: () => void
}) {
  const [msgs, setMsgs] = React.useState<Mensagem[]>([])
  const [texto, setTexto] = React.useState("")
  const [interna, setInterna] = React.useState(false)
  const [email, setEmail] = React.useState(true)
  const [aviso, setAviso] = React.useState("")

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data } = await sb
      .from("chamado_mensagens")
      .select("*")
      .eq("chamado_id", chamado.id)
      .order("criado", { ascending: true })
    setMsgs((data as Mensagem[] | null) ?? [])
  }, [chamado.id])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function responder(e: React.FormEvent) {
    e.preventDefault()
    const sb = portalBrowserClient()
    if (!sb || !texto.trim()) return
    setAviso("")
    const { data, error } = await sb
      .from("chamado_mensagens")
      .insert({
        chamado_id: chamado.id,
        da_equipe: equipe,
        interna: equipe && interna,
        texto: texto.trim(),
      })
      .select("id")
      .single()
    if (error) return setAviso("Não foi possível enviar.")
    if (equipe && !interna && email && data) {
      const s = (await sb.auth.getSession()).data.session
      const r = await fetch("/api/portal/chamados/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s?.access_token ?? ""}`,
        },
        body: JSON.stringify({ mensagemId: (data as { id: number }).id }),
      })
      const j = (await r.json().catch(() => ({}))) as { erro?: string }
      setAviso(
        r.ok
          ? "Resposta salva e enviada por e-mail."
          : `Resposta salva. E-mail: ${j.erro ?? "não enviado"}`
      )
    }
    setTexto("")
    await carregar()
    aoMudar()
  }

  async function mudarStatus(status: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    await sb.from("chamados").update({ status }).eq("id", chamado.id)
    aoMudar()
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-xs font-bold text-slate-500">{chamado.protocolo}</span>
          <h3 className="text-lg font-extrabold">{chamado.assunto}</h3>
          <span className="text-sm text-slate-600">
            {chamado.cliente_nome}
            {chamado.cliente_contato ? ` · ${chamado.cliente_contato}` : ""} · via {chamado.canal} ·{" "}
            {chamado.categoria}
          </span>
        </div>
        {equipe ? (
          <select
            value={chamado.status}
            onChange={(e) => mudarStatus(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            {Object.entries(STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">
            {STATUS[chamado.status]}
          </span>
        )}
      </div>
      <ol className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
        {msgs.map((m) => (
          <li
            key={m.id}
            className={`rounded-xl p-3 text-sm ${m.interna ? "border border-dashed border-amber-300 bg-amber-50" : m.da_equipe ? "bg-[var(--brand-soft)]" : "bg-slate-50"}`}
          >
            <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
              <b>
                {m.autor_nome ?? (m.da_equipe ? "Equipe" : "Cliente")}
                {m.interna ? " · nota interna" : ""}
              </b>
              <span>
                {dataHora(m.criado)}
                {m.email_enviado ? " · enviado por e-mail" : ""}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{m.texto}</p>
          </li>
        ))}
        {msgs.length === 0 ? (
          <li className="text-sm text-slate-500">Sem mensagens ainda.</li>
        ) : null}
      </ol>
      {chamado.status !== "fechado" ? (
        <form onSubmit={responder} className="flex flex-col gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder={equipe ? "Escreva a resposta ao cliente" : "Escreva a sua mensagem"}
            className="rounded-lg border border-slate-300 p-3 text-sm"
          />
          {equipe ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                <input
                  type="checkbox"
                  checked={interna}
                  onChange={(e) => setInterna(e.target.checked)}
                  className="mr-1"
                />
                Nota interna (o cliente não vê)
              </label>
              {!interna ? (
                <label>
                  <input
                    type="checkbox"
                    checked={email}
                    onChange={(e) => setEmail(e.target.checked)}
                    className="mr-1"
                  />
                  Enviar também por e-mail
                </label>
              ) : null}
            </div>
          ) : null}
          <button className="self-start rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white">
            Enviar
          </button>
          {aviso ? <p className="text-sm font-bold">{aviso}</p> : null}
        </form>
      ) : null}
    </div>
  )
}

function NovoChamado({
  equipe,
  inicial,
  aoCriar,
}: {
  equipe: boolean
  inicial?: { cliente?: string; nome?: string; contato?: string }
  aoCriar: (id: string) => void
}) {
  const [erro, setErro] = React.useState("")
  async function criar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return
    setErro("")
    const { data: u } = await sb.auth.getUser()
    const assunto = String(fd.get("assunto") ?? "").trim()
    const texto = String(fd.get("texto") ?? "").trim()
    const linha = equipe
      ? {
          cliente_id: inicial?.cliente || null,
          cliente_nome: String(fd.get("cliente_nome") ?? "").trim(),
          cliente_contato: String(fd.get("cliente_contato") ?? "").trim() || null,
          assunto,
          categoria: String(fd.get("categoria") ?? "duvida"),
          canal: String(fd.get("canal") ?? "telefone"),
        }
      : {
          cliente_id: u.user?.id ?? null,
          cliente_nome: String(fd.get("cliente_nome") ?? "").trim() || u.user?.email || "Cliente",
          cliente_contato: u.user?.email ?? null,
          assunto,
          categoria: String(fd.get("categoria") ?? "duvida"),
          canal: "site",
        }
    const { data, error } = await sb.from("chamados").insert(linha).select("id").single()
    if (error || !data) return setErro("Não foi possível abrir o chamado.")
    const id = (data as { id: string }).id
    if (texto)
      await sb.from("chamado_mensagens").insert({ chamado_id: id, da_equipe: equipe, texto })
    aoCriar(id)
  }
  const campo = "h-10 rounded-lg border border-slate-300 px-3 text-sm"
  return (
    <form
      action={criar}
      className="grid gap-2 rounded-2xl border border-slate-200 p-5 sm:grid-cols-2"
    >
      <b className="sm:col-span-2">Novo chamado</b>
      <input
        name="cliente_nome"
        required={equipe}
        defaultValue={inicial?.nome ?? ""}
        placeholder="Nome do cliente"
        className={campo}
      />
      {equipe ? (
        <input
          name="cliente_contato"
          defaultValue={inicial?.contato ?? ""}
          placeholder="E-mail ou WhatsApp"
          className={campo}
        />
      ) : null}
      <input
        name="assunto"
        required
        minLength={3}
        placeholder="Assunto"
        className={`${campo} sm:col-span-2`}
      />
      <select name="categoria" className={`${campo} bg-white`}>
        {CATS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {equipe ? (
        <select name="canal" defaultValue="telefone" className={`${campo} bg-white`}>
          <option value="telefone">Telefone</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">E-mail</option>
          <option value="site">Site</option>
        </select>
      ) : null}
      <textarea
        name="texto"
        rows={3}
        placeholder="Descreva o pedido"
        className="rounded-lg border border-slate-300 p-3 text-sm sm:col-span-2"
      />
      {erro ? <p className="text-sm font-bold text-red-700 sm:col-span-2">{erro}</p> : null}
      <button className="h-10 rounded-lg bg-[var(--brand)] font-bold text-white sm:col-span-2">
        Abrir chamado
      </button>
    </form>
  )
}

export function Chamados({ equipe }: { equipe: boolean }) {
  const [lista, setLista] = React.useState<Chamado[] | null>(null)
  const [filtro, setFiltro] = React.useState("abertos")
  const [sel, setSel] = React.useState<string | null>(null)
  const [novo, setNovo] = React.useState(false)
  const [inicial, setInicial] = React.useState<{
    cliente?: string
    nome?: string
    contato?: string
  }>()

  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get("novo")) {
      const t = setTimeout(() => {
        setNovo(true)
        setInicial({
          cliente: sp.get("cliente") ?? undefined,
          nome: sp.get("nome") ?? undefined,
          contato: sp.get("contato") ?? undefined,
        })
      }, 0)
      return () => clearTimeout(t)
    }
  }, [])

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    let q = sb.from("chamados").select("*").order("atualizado", { ascending: false }).limit(200)
    if (filtro === "abertos") q = q.not("status", "in", "(resolvido,fechado)")
    else if (filtro !== "todos") q = q.eq("status", filtro)
    const { data } = await q
    setLista((data as Chamado[] | null) ?? [])
  }, [filtro])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  const atual = lista?.find((c) => c.id === sel) ?? null

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="abertos">Em aberto</option>
            <option value="todos">Todos</option>
            {Object.entries(STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setNovo((v) => !v)}
            className="rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white"
          >
            {novo ? "Fechar" : "Novo"}
          </button>
        </div>
        {novo ? (
          <NovoChamado
            equipe={equipe}
            inicial={inicial}
            aoCriar={async (id) => {
              setNovo(false)
              await carregar()
              setSel(id)
            }}
          />
        ) : null}
        {lista === null ? <p className="text-sm text-slate-600">Carregando...</p> : null}
        {lista?.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum chamado aqui.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {lista?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSel(c.id)}
                className={`w-full rounded-xl border p-3 text-left text-sm ${sel === c.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-slate-200"}`}
              >
                <div className="flex justify-between gap-2 text-xs text-slate-500">
                  <b>{c.protocolo}</b>
                  <span>{STATUS[c.status]}</span>
                </div>
                <b className="block">{c.assunto}</b>
                <span className="text-xs text-slate-600">
                  {c.cliente_nome} · {dataHora(c.atualizado)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {atual ? (
          <Conversa key={atual.id} chamado={atual} equipe={equipe} aoMudar={carregar} />
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
            Escolha um chamado para ver a conversa.
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ equipe */

export function EquipeGestao() {
  const [membros, setMembros] = React.useState<Cliente[]>([])
  const [email, setEmail] = React.useState("")
  const [msg, setMsg] = React.useState("")
  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data } = await sb.rpc("equipe_clientes", { p_tipo: "atendente", p_busca: null })
    setMembros((data as Cliente[] | null) ?? [])
  }, [])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    const sb = portalBrowserClient()
    if (!sb) return
    const { data } = await sb.rpc("equipe_clientes", { p_tipo: null, p_busca: email.trim() })
    const alvo = ((data as Cliente[] | null) ?? []).find(
      (c) => c.email?.toLowerCase() === email.trim().toLowerCase()
    )
    if (!alvo)
      return setMsg("Ninguém com esse e-mail. A pessoa precisa criar a conta no site primeiro.")
    const { error } = await sb
      .from("perfis")
      .update({ perfil: "atendente" })
      .eq("user_id", alvo.user_id)
    setMsg(
      error
        ? "Não foi possível adicionar."
        : `${alvo.nome ?? alvo.email} agora faz parte da equipe.`
    )
    setEmail("")
    await carregar()
  }

  async function remover(c: Cliente) {
    const sb = portalBrowserClient()
    if (!sb) return
    await sb.from("perfis").update({ perfil: "comprador" }).eq("user_id", c.user_id)
    setMsg(`${c.nome ?? c.email} saiu da equipe.`)
    await carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        A equipe vê clientes, a situação da cobrança e os chamados, e pode enviar troca de senha.
        Não vê o financeiro, os valores recebidos, os dados bancários nem os documentos. Tudo o que
        fizer fica na auditoria.
      </p>
      <form onSubmit={adicionar} className="flex flex-wrap gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          placeholder="E-mail da pessoa (já cadastrada no site)"
          className="h-10 min-w-[280px] flex-1 rounded-lg border border-slate-300 px-3"
        />
        <button className="rounded-lg bg-[var(--brand)] px-5 font-bold text-white">
          Adicionar à equipe
        </button>
      </form>
      {msg ? <p className="text-sm font-bold">{msg}</p> : null}
      <ul className="flex flex-col gap-2">
        {membros.map((m) => (
          <li
            key={m.user_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm"
          >
            <span>
              <b>{m.nome}</b> · {m.email}
            </span>
            <span className="flex gap-3">
              <Link
                href={`/gestao/auditoria?autor=${m.user_id}`}
                className="font-bold text-[var(--brand)]"
              >
                Ver o que fez
              </Link>
              <button type="button" onClick={() => remover(m)} className="font-bold text-red-700">
                Remover
              </button>
            </span>
          </li>
        ))}
        {membros.length === 0 ? (
          <li className="text-sm text-slate-500">Nenhuma pessoa na equipe ainda.</li>
        ) : null}
      </ul>
    </div>
  )
}

/* --------------------------------------------------------------- auditoria */

type Registro = {
  id: number
  quando: string
  autor_id: string | null
  autor_nome: string | null
  tabela: string
  registro: string | null
  acao: string
  detalhe: Record<string, unknown> | null
}

const TABELAS: Record<string, string> = {
  perfis: "Cadastro",
  leads: "Lead",
  lead_ofertas: "Rodízio de lead",
  imoveis_avulsos: "Imóvel avulso",
  parceiros: "Parceiro",
  cotas_reservas: "Reserva de cota",
  cotas_grupos: "Grupo de cotas",
  config_portal: "Configuração",
  pedidos: "Pedido",
  chamados: "Chamado",
  chamado_mensagens: "Mensagem de chamado",
  acao_manual: "Ação da equipe",
}

export function AuditoriaGestao() {
  const [itens, setItens] = React.useState<Registro[] | null>(null)
  const [tabela, setTabela] = React.useState("")
  const [autor, setAutor] = React.useState("")
  React.useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("autor")
    if (a) {
      const t = setTimeout(() => setAutor(a), 0)
      return () => clearTimeout(t)
    }
  }, [])
  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    let q = sb.from("auditoria").select("*").order("quando", { ascending: false }).limit(300)
    if (tabela) q = q.eq("tabela", tabela)
    if (/^[0-9a-f-]{36}$/.test(autor)) q = q.eq("autor_id", autor)
    const { data } = await q
    setItens((data as Registro[] | null) ?? [])
  }, [tabela, autor])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={tabela}
          onChange={(e) => setTabela(e.target.value)}
          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">Tudo</option>
          {Object.entries(TABELAS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {autor ? (
          <button
            type="button"
            onClick={() => setAutor("")}
            className="rounded-lg border border-slate-300 px-3 text-sm font-bold"
          >
            Limpar filtro de pessoa
          </button>
        ) : null}
      </div>
      {itens === null ? <p className="text-slate-600">Carregando...</p> : null}
      <ol className="flex flex-col gap-1.5 text-sm">
        {itens?.map((r) => (
          <li
            key={r.id}
            className="grid gap-1 rounded-lg border border-slate-100 p-3 sm:grid-cols-[150px_180px_1fr]"
          >
            <span className="text-xs text-slate-500 tabular-nums">{dataHora(r.quando)}</span>
            <span>
              <b>{r.autor_nome ?? "sistema"}</b>
            </span>
            <span>
              {r.acao} · {TABELAS[r.tabela] ?? r.tabela}
              {r.registro ? (
                <span className="text-xs text-slate-500"> ({r.registro.slice(0, 40)})</span>
              ) : null}
              {r.detalhe ? (
                <code className="mt-1 block text-xs break-all text-slate-600">
                  {JSON.stringify(r.detalhe).slice(0, 400)}
                </code>
              ) : null}
            </span>
          </li>
        ))}
        {itens?.length === 0 ? <li className="text-slate-500">Nada registrado ainda.</li> : null}
      </ol>
    </div>
  )
}

/* -------------------------------------------------------- suporte do cliente */

export function SuporteCliente() {
  const [logado, setLogado] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) {
      const t = setTimeout(() => setLogado(false), 0)
      return () => clearTimeout(t)
    }
    sb.auth.getUser().then(({ data }) => setLogado(!!data.user))
  }, [])
  if (logado === null) return <p className="text-slate-600">Carregando...</p>
  if (!logado)
    return (
      <p>
        <Link href="/corretores/entrar?volta=/suporte" className="font-bold text-[var(--brand)]">
          Entre na sua conta
        </Link>{" "}
        para abrir e acompanhar chamados. Se preferir, ligue para o 0800 543 1000.
      </p>
    )
  return <Chamados equipe={false} />
}

/* -------------------------------------------------------- leads (só o CEO) */

type LeadCentral = {
  id: string
  nome: string
  telefone: string
  email: string | null
  mensagem: string | null
  imovel_id: string | null
  origem: string | null
  interesse: string
  status: string
  etapa: string | null
  corretor_id: string | null
  trava_ate: string | null
  cidade: string | null
  uf: string | null
  criado: string
}

type Sugestao = {
  user_id: string
  nome: string | null
  perfil: string
  cidade: string | null
  uf: string | null
  nivel: string
  km: number | null
  ja_recebeu: boolean
}

function LeadCard({
  l,
  nomes,
  aoMudar,
}: {
  l: LeadCentral
  nomes: Record<string, string>
  aoMudar: () => void
}) {
  const [sug, setSug] = React.useState<Sugestao[] | null>(null)
  const [fb, setFb] = React.useState<{ etapa: string; texto: string; criado: string }[] | null>(
    null
  )
  const [msg, setMsg] = React.useState("")
  const prazo = useConfigPortal().rodizio.prazo_minutos

  async function sugerir() {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data, error } = await sb.rpc("sugerir_parceiros", { p_lead: l.id })
    if (error) setMsg("Sugestão indisponível: o banco precisa da atualização 010.")
    setSug((data as Sugestao[] | null) ?? [])
  }
  async function encaminhar(p: Sugestao) {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data, error } = await sb.rpc("encaminhar_lead", { p_lead: l.id, p_parceiro: p.user_id })
    setMsg(
      error || !data
        ? "Não foi possível encaminhar."
        : `Encaminhado para ${p.nome}. Prazo de ${prazo} minutos para aceitar.`
    )
    setSug(null)
    aoMudar()
  }
  async function verRetornos() {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data } = await sb
      .from("lead_feedbacks")
      .select("etapa, texto, criado")
      .eq("lead_id", l.id)
      .order("criado", { ascending: false })
    setFb((data as typeof fb) ?? [])
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <b className="text-base">{l.nome}</b>
        <span className="text-xs text-slate-500">
          {dataHora(l.criado)} · {l.origem ?? "site"} · {l.interesse}
        </span>
      </div>
      <span>
        {l.telefone}
        {l.email ? ` · ${l.email}` : ""}
        {l.imovel_id ? (
          <>
            {" · "}
            <Link href={`/leiloes/${l.imovel_id}`} className="font-bold text-[var(--brand)]">
              imóvel {l.imovel_id}
            </Link>
          </>
        ) : null}
      </span>
      {l.mensagem ? <p className="text-slate-600">{l.mensagem}</p> : null}
      <span className="text-xs">
        Situação: <b>{l.status}</b>
        {l.etapa ? ` · etapa ${l.etapa}` : ""}
        {l.corretor_id ? ` · com ${nomes[l.corretor_id] ?? "parceiro"}` : " · na central"}
        {l.trava_ate ? ` · aceitar até ${dataHora(l.trava_ate)}` : ""}
      </span>
      <div className="flex flex-wrap gap-3">
        {!["em_atendimento", "vendido", "perdido"].includes(l.status) ? (
          <button type="button" onClick={sugerir} className="font-bold text-[var(--brand)]">
            Parceiros mais próximos
          </button>
        ) : null}
        <button type="button" onClick={verRetornos} className="font-bold text-slate-700">
          Ver retornos do parceiro
        </button>
      </div>
      {msg ? <p className="font-bold">{msg}</p> : null}
      {sug ? (
        <ul className="flex flex-col gap-1 rounded-xl bg-slate-50 p-3">
          {sug.length === 0 ? <li>Nenhum corretor ou imobiliária parceira no estado.</li> : null}
          {sug.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{p.nome}</b> · {p.perfil} · {p.cidade}/{p.uf} · {p.nivel}
                {p.km != null ? ` · ${p.km} km` : ""}
                {p.ja_recebeu ? " · já recebeu este lead" : ""}
              </span>
              <button
                type="button"
                onClick={() => encaminhar(p)}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-bold text-white"
              >
                Encaminhar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {fb ? (
        <ol className="flex flex-col gap-1 text-xs text-slate-600">
          {fb.length === 0 ? <li>Sem retorno registrado ainda.</li> : null}
          {fb.map((f, i) => (
            <li key={i}>
              {dataHora(f.criado)} · <b>{f.etapa}</b>: {f.texto}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  )
}

export function LeadsGestao() {
  const prazoLeads = useConfigPortal().rodizio.prazo_minutos
  const [filtro, setFiltro] = React.useState("central")
  const [lista, setLista] = React.useState<LeadCentral[] | null>(null)
  const [nomes, setNomes] = React.useState<Record<string, string>>({})
  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    await sb.rpc("redistribuir_leads_vencidos")
    let q = sb.from("leads").select("*").order("criado", { ascending: false }).limit(200)
    if (filtro === "central") q = q.is("corretor_id", null).not("status", "in", "(vendido,perdido)")
    else if (filtro === "encaminhados") q = q.not("corretor_id", "is", null)
    const { data } = await q
    const ls = (data as LeadCentral[] | null) ?? []
    setLista(ls)
    const ids = [...new Set(ls.map((l) => l.corretor_id).filter((x): x is string => !!x))]
    if (ids.length) {
      const { data: ps } = await sb.from("perfis").select("user_id, nome").in("user_id", ids)
      setNomes(
        Object.fromEntries(
          ((ps ?? []) as { user_id: string; nome: string }[]).map((p) => [p.user_id, p.nome])
        )
      )
    }
  }, [filtro])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        Todo lead cai aqui primeiro. Veja os parceiros mais próximos (corretores e imobiliárias,
        nunca investidores) e encaminhe. O parceiro aceita o termo de indicação e tem {prazoLeads}{" "}
        minutos; se não aceitar, o lead volta para a central.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["central", "Na central"],
            ["encaminhados", "Com parceiros"],
            ["todos", "Todos"],
          ] as [string, string][]
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setFiltro(v)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${filtro === v ? "bg-slate-900 text-white" : "border border-slate-300"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {lista === null ? <p className="text-slate-600">Carregando...</p> : null}
      {lista?.length === 0 ? <p className="text-slate-500">Nenhum lead aqui.</p> : null}
      <ul className="flex flex-col gap-3">
        {lista?.map((l) => (
          <LeadCard key={l.id} l={l} nomes={nomes} aoMudar={carregar} />
        ))}
      </ul>
    </div>
  )
}
