"use client"

import * as React from "react"
import Link from "next/link"

import { usePapel } from "@/components/portal/gestao"
import { portalBrowserClient } from "@/lib/portal/browser-client"
import { CONFIG_PADRAO, montarConfig, type ConfigPortal } from "@/lib/portal/config-portal"
import { aplicarAjustePlanos, type Plano, type PlanoId } from "@/lib/portal/planos"

/* -------------------------------------------------------------- utilidades */

const rotulo = "flex flex-col gap-1 text-sm font-bold text-slate-700"
const campo = "h-10 rounded-lg border border-slate-300 bg-white px-3 font-normal text-slate-900"

function Numero({
  label,
  valor,
  onChange,
  sufixo,
  passo = 1,
  vazio = false,
}: {
  label: string
  valor: number | null
  onChange: (v: number | null) => void
  sufixo?: string
  passo?: number
  vazio?: boolean
}) {
  return (
    <label className={rotulo}>
      {label}
      <span className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step={passo}
          min={0}
          value={valor ?? ""}
          placeholder={vazio ? "a definir" : undefined}
          onChange={(e) => {
            const t = e.target.value.replace(",", ".")
            onChange(t === "" ? null : Number(t))
          }}
          className={`${campo} w-full`}
        />
        {sufixo ? <span className="text-sm font-normal text-slate-500">{sufixo}</span> : null}
      </span>
    </label>
  )
}

function Bloco({
  titulo,
  texto,
  children,
}: {
  titulo: string
  texto?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-5">
      <div>
        <h2 className="text-lg font-extrabold">{titulo}</h2>
        {texto ? <p className="text-sm text-slate-600">{texto}</p> : null}
      </div>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------ configurações */

/** Área do CEO para definir valores, cobranças e regras do portal. */
export function ConfiguracoesGestao() {
  const papel = usePapel()
  const [cfg, setCfg] = React.useState<ConfigPortal | null>(null)
  const [planos, setPlanos] = React.useState<Plano[]>(aplicarAjustePlanos({}))
  const [salvando, setSalvando] = React.useState(false)
  const [msg, setMsg] = React.useState("")
  const [atualizado, setAtualizado] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (papel !== "ceo") return
    const sb = portalBrowserClient()
    if (!sb) return
    void sb
      .from("config_portal")
      .select("chave, valor, atualizado")
      .then(({ data, error }) => {
        if (error) setMsg("Não consegui ler as configurações. Confira se o banco está atualizado.")
        const linhas =
          (data as { chave: string; valor: unknown; atualizado: string }[] | null) ?? []
        const c = montarConfig(linhas)
        setCfg(c)
        setPlanos(aplicarAjustePlanos(c.planos))
        const ult = linhas
          .map((l) => l.atualizado)
          .sort()
          .pop()
        setAtualizado(ult ?? null)
      })
  }, [papel])

  if (papel !== "ceo") return <p className="text-slate-600">Configurações são exclusivas do CEO.</p>
  if (!cfg) return <p className="text-slate-600">Carregando...</p>

  function mudar<K extends keyof ConfigPortal>(k: K, v: Partial<ConfigPortal[K]>) {
    setCfg((c) => (c ? { ...c, [k]: { ...(c[k] as object), ...v } } : c))
  }

  function mudarPlano(id: PlanoId, v: Partial<Plano>) {
    setPlanos((ps) => ps.map((p) => (p.id === id ? { ...p, ...v } : p)))
  }

  function validar(c: ConfigPortal): string | null {
    const a = c.comissao_avulso
    if (Math.abs(a.plataforma + a.corretor - a.total) > 0.001)
      return `Imóveis avulsos: plataforma (${a.plataforma}%) + corretor (${a.corretor}%) precisa dar o total (${a.total}%).`
    const l = c.parceria_leilao
    for (const v of [
      l.corretor_com_documentacao,
      l.corretor_sem_documentacao,
      c.parceria_leilao_imobiliaria.imobiliaria,
    ])
      if (v == null || v < 0 || v > 100)
        return "Os percentuais da parceria precisam ficar entre 0 e 100."
    if (c.rodizio.prazo_minutos < 5) return "O prazo do lead precisa ser de pelo menos 5 minutos."
    for (const p of planos)
      if (!(p.mensal > 0) || !(p.anual > 0))
        return `Plano ${p.nome}: informe o preço mensal e o anual.`
    if (!c.termo_indicacao.versao.trim()) return "Informe a versão dos contratos."
    return null
  }

  async function salvar() {
    if (!cfg) return
    setMsg("")
    const erro = validar(cfg)
    if (erro) return setMsg(erro)
    const sb = portalBrowserClient()
    if (!sb) return
    setSalvando(true)
    const planosAjuste = Object.fromEntries(
      planos.map((p) => [
        p.id,
        {
          nome: p.nome,
          para: p.para,
          mensal: p.mensal,
          anual: p.anual,
          destaque: !!p.destaque,
          recursos: p.recursos,
        },
      ])
    )
    const agora = new Date().toISOString()
    const linhas = [
      { chave: "planos", valor: planosAjuste },
      { chave: "parceria_regras", valor: cfg.parceria_regras },
      { chave: "parceria_leilao", valor: cfg.parceria_leilao },
      { chave: "parceria_leilao_imobiliaria", valor: cfg.parceria_leilao_imobiliaria },
      { chave: "comissao_avulso", valor: cfg.comissao_avulso },
      { chave: "plano_anuncio_proprietario", valor: cfg.plano_anuncio_proprietario },
      { chave: "rodizio", valor: cfg.rodizio },
      { chave: "termo_indicacao", valor: cfg.termo_indicacao },
    ].map((l) => ({ ...l, atualizado: agora }))
    const { error } = await sb.from("config_portal").upsert(linhas, { onConflict: "chave" })
    setSalvando(false)
    if (error) return setMsg("Não foi possível salvar. Confira se você entrou como CEO.")
    setAtualizado(agora)
    setMsg("Salvo. Os novos valores já valem no site, nos contratos e no pagamento.")
  }

  const r = cfg.parceria_regras
  const l = cfg.parceria_leilao
  const a = cfg.comissao_avulso

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-slate-600">
        Tudo que você gravar aqui muda os preços cobrados, as comissões e o texto dos contratos
        publicados no site. Cada alteração fica registrada na auditoria com o seu nome.
        {atualizado
          ? ` Última alteração: ${new Date(atualizado).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`
          : ""}
      </p>

      <Bloco
        titulo="Planos de assinatura"
        texto="Preço cobrado no pagamento. Quem já assina continua no preço contratado até renovar ou trocar de plano."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {planos.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4">
              <label className={rotulo}>
                Nome
                <input
                  value={p.nome}
                  onChange={(e) => mudarPlano(p.id, { nome: e.target.value })}
                  className={campo}
                />
              </label>
              <label className={rotulo}>
                Para quem
                <input
                  value={p.para}
                  onChange={(e) => mudarPlano(p.id, { para: e.target.value })}
                  className={campo}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Numero
                  label="Mensal (R$)"
                  passo={0.1}
                  valor={p.mensal}
                  onChange={(v) => mudarPlano(p.id, { mensal: v ?? 0 })}
                />
                <Numero
                  label="Anual (R$)"
                  passo={1}
                  valor={p.anual}
                  onChange={(v) => mudarPlano(p.id, { anual: v ?? 0 })}
                />
              </div>
              <label className={rotulo}>
                O que inclui (um item por linha)
                <textarea
                  rows={7}
                  value={p.recursos.join("\n")}
                  onChange={(e) => mudarPlano(p.id, { recursos: e.target.value.split("\n") })}
                  className="rounded-lg border border-slate-300 bg-white p-3 text-sm font-normal"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={!!p.destaque}
                  onChange={(e) =>
                    setPlanos((ps) =>
                      ps.map((x) => ({ ...x, destaque: x.id === p.id ? e.target.checked : false }))
                    )
                  }
                />
                Plano recomendado (destaque)
              </label>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco
        titulo="Corretor: adesão, mensalidade e gratuidade"
        texto="Parceiro com contrato não paga mensalidade enquanto estiver ativo. Quem trabalha sozinho paga a adesão e o plano."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            label="Taxa de adesão (R$)"
            passo={0.1}
            vazio
            valor={r.taxa_adesao}
            onChange={(v) => mudar("parceria_regras", { taxa_adesao: v })}
          />
          <Numero
            label="Taxa de administração (R$)"
            passo={0.1}
            vazio
            valor={r.taxa_administracao}
            onChange={(v) => mudar("parceria_regras", { taxa_administracao: v })}
          />
          <Numero
            label="Inativo depois de"
            sufixo="meses"
            valor={r.inatividade_meses}
            onChange={(v) => mudar("parceria_regras", { inatividade_meses: v ?? 3 })}
          />
          <Numero
            label="Cada venda garante"
            sufixo="meses grátis"
            valor={r.bonus_venda_meses}
            onChange={(v) => mudar("parceria_regras", { bonus_venda_meses: v ?? 12 })}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Comissão nos imóveis de leilão"
        texto="Percentual da comissão recebida pela empresa que vai para o parceiro."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            label="Corretor com documentação"
            sufixo="%"
            valor={l.corretor_com_documentacao}
            onChange={(v) => mudar("parceria_leilao", { corretor_com_documentacao: v ?? 0 })}
          />
          <Numero
            label="Corretor sem documentação"
            sufixo="%"
            valor={l.corretor_sem_documentacao}
            onChange={(v) => mudar("parceria_leilao", { corretor_sem_documentacao: v ?? 0 })}
          />
          <Numero
            label="Imobiliária (emite NF)"
            sufixo="%"
            valor={cfg.parceria_leilao_imobiliaria.imobiliaria}
            onChange={(v) => mudar("parceria_leilao_imobiliaria", { imobiliaria: v ?? 0 })}
          />
          <Numero
            label="Indicação simples"
            sufixo="%"
            vazio
            valor={l.indicacao}
            onChange={(v) => mudar("parceria_leilao", { indicacao: v })}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Imóveis avulsos e anúncio do proprietário"
        texto="Comissão paga pelo vendedor quando a venda sai com corretor parceiro, e o plano de quem anuncia sem corretor."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Numero
            label="Comissão total"
            sufixo="%"
            passo={0.5}
            valor={a.total}
            onChange={(v) => mudar("comissao_avulso", { total: v ?? 0 })}
          />
          <Numero
            label="Para a plataforma"
            sufixo="%"
            passo={0.5}
            valor={a.plataforma}
            onChange={(v) => mudar("comissao_avulso", { plataforma: v ?? 0 })}
          />
          <Numero
            label="Para o corretor"
            sufixo="%"
            passo={0.5}
            valor={a.corretor}
            onChange={(v) => mudar("comissao_avulso", { corretor: v ?? 0 })}
          />
          <Numero
            label="Plano do proprietário (R$)"
            passo={0.1}
            valor={cfg.plano_anuncio_proprietario.preco}
            onChange={(v) => mudar("plano_anuncio_proprietario", { preco: v ?? 0 })}
          />
          <Numero
            label="Duração do plano"
            sufixo="dias"
            valor={cfg.plano_anuncio_proprietario.dias}
            onChange={(v) => mudar("plano_anuncio_proprietario", { dias: v ?? 60 })}
          />
        </div>
      </Bloco>

      <Bloco titulo="Leads e termo de indicação">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={rotulo}>
            Distribuição
            <select
              value={cfg.rodizio.modo}
              onChange={(e) =>
                mudar("rodizio", { modo: e.target.value as ConfigPortal["rodizio"]["modo"] })
              }
              className={campo}
            >
              <option value="manual">Manual: o CEO escolhe o parceiro</option>
              <option value="automatico">Automático: o mais próximo</option>
            </select>
          </label>
          <Numero
            label="Prazo para aceitar o lead"
            sufixo="min"
            valor={cfg.rodizio.prazo_minutos}
            onChange={(v) => mudar("rodizio", { prazo_minutos: v ?? 30 })}
          />
          <Numero
            label="Proibição de negociar por fora"
            sufixo="meses"
            valor={cfg.termo_indicacao.nao_aliciamento_meses ?? 12}
            onChange={(v) => mudar("termo_indicacao", { nao_aliciamento_meses: v ?? 12 })}
          />
          <label className={rotulo}>
            Versão dos contratos (parceria e indicação)
            <input
              value={cfg.termo_indicacao.versao}
              onChange={(e) => mudar("termo_indicacao", { versao: e.target.value })}
              className={campo}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Mudou comissão, prazo ou regra? Troque também a versão (por exemplo 2026-11-v2). O
          contrato publicado passa a mostrar a nova versão, o parceiro precisa aceitar o termo novo
          antes do próximo lead e cada aceite fica ligado à versão que valia naquele dia.
        </p>
      </Bloco>

      <Bloco titulo="Outros valores">
        <p className="text-sm text-slate-600">
          Os preços de publicidade (anúncio simples e destaque, por portal) ficam em{" "}
          <Link href="/gestao/publicidade" className="font-bold text-[var(--brand)]">
            Publicidade
          </Link>
          . Os dados de cada cliente, inclusive plano e validade, você edita em{" "}
          <Link href="/gestao/clientes" className="font-bold text-[var(--brand)]">
            Clientes &gt; Editar dados
          </Link>
          .
        </p>
      </Bloco>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <button
          type="button"
          disabled={salvando}
          onClick={salvar}
          className="rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white disabled:opacity-60"
        >
          {salvando ? "Salvando..." : "Salvar configurações"}
        </button>
        <button
          type="button"
          onClick={() => {
            setCfg(structuredClone(CONFIG_PADRAO))
            setPlanos(aplicarAjustePlanos({}))
            setMsg("Valores padrão carregados na tela. Nada foi gravado ainda.")
          }}
          className="rounded-full border border-slate-300 px-5 py-3 text-sm font-bold"
        >
          Voltar aos padrões
        </button>
        {msg ? <span className="text-sm font-bold">{msg}</span> : null}
      </div>
    </div>
  )
}

/* ---------------------------------------------------- editar dados (cliente) */

type CampoPerfil = {
  k: string
  l: string
  tipo?: "texto" | "numero" | "data" | "sim" | "lista" | "longo" | "opcoes"
  opcoes?: [string, string][]
}

const CAMPOS_PERFIL: [string, CampoPerfil[]][] = [
  [
    "Identificação",
    [
      { k: "nome", l: "Nome" },
      { k: "email", l: "E-mail de contato" },
      {
        k: "perfil",
        l: "Categoria",
        tipo: "opcoes",
        opcoes: [
          ["corretor", "Corretor"],
          ["imobiliaria", "Imobiliária"],
          ["investidor", "Investidor"],
          ["proprietario", "Proprietário"],
          ["comprador", "Comprador"],
          ["atendente", "Equipe (atendente)"],
        ],
      },
      { k: "creci", l: "CRECI" },
      { k: "creci_uf", l: "UF do CRECI" },
      { k: "slug", l: "Endereço da página (slug)" },
    ],
  ],
  [
    "Contato",
    [
      { k: "whatsapp", l: "WhatsApp principal" },
      { k: "telefone_1", l: "Telefone 1" },
      { k: "telefone_1_whats", l: "Telefone 1 é WhatsApp", tipo: "sim" },
      { k: "telefone_2", l: "Telefone 2" },
      { k: "telefone_2_whats", l: "Telefone 2 é WhatsApp", tipo: "sim" },
      { k: "recado_1", l: "Recado 1" },
      { k: "recado_2", l: "Recado 2" },
    ],
  ],
  [
    "Endereço e atuação",
    [
      { k: "cep", l: "CEP" },
      { k: "endereco", l: "Endereço" },
      { k: "numero", l: "Número" },
      { k: "complemento", l: "Complemento" },
      { k: "bairro", l: "Bairro" },
      { k: "cidade", l: "Cidade" },
      { k: "uf", l: "UF" },
      { k: "bairros_atuacao", l: "Bairros de atuação (separe por vírgula)", tipo: "lista" },
      { k: "atua_desde", l: "Atua desde (ano)", tipo: "numero" },
      { k: "bio", l: "História", tipo: "longo" },
    ],
  ],
  [
    "Cadastro, cobrança e selos",
    [
      {
        k: "status",
        l: "Situação do cadastro",
        tipo: "opcoes",
        opcoes: [
          ["pendente", "Pendente"],
          ["aprovado", "Aprovado"],
          ["recusado", "Recusado"],
        ],
      },
      { k: "creci_ok", l: "CRECI conferido", tipo: "sim" },
      { k: "motivo", l: "Motivo (recusa ou observação)" },
      {
        k: "plano",
        l: "Plano",
        tipo: "opcoes",
        opcoes: [
          ["gratis", "Grátis"],
          ["essencial", "Essencial"],
          ["profissional", "Profissional"],
          ["premium", "Premium"],
        ],
      },
      { k: "plano_ate", l: "Plano válido até", tipo: "data" },
      { k: "gratis_ate", l: "Gratuidade de parceiro até", tipo: "data" },
      { k: "recebe_leads", l: "Recebe leads", tipo: "sim" },
      { k: "selo_verde", l: "Selo Verde", tipo: "sim" },
      { k: "email_verificado", l: "E-mail verificado", tipo: "sim" },
      { k: "whatsapp_verificado", l: "WhatsApp verificado", tipo: "sim" },
      { k: "redes_verificadas", l: "Redes verificadas", tipo: "sim" },
      { k: "pix_chave", l: "Chave PIX" },
    ],
  ],
]

const paraData = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : "")

/** Formulário do CEO para corrigir qualquer dado cadastral de um cliente. */
export function EditarPerfil({
  userId,
  onFechar,
}: {
  userId: string
  onFechar: (salvou: boolean) => void
}) {
  const [orig, setOrig] = React.useState<Record<string, unknown> | null>(null)
  const [dados, setDados] = React.useState<Record<string, unknown>>({})
  const [msg, setMsg] = React.useState("")
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    void sb
      .from("perfis")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return setMsg("Não foi possível abrir este cadastro.")
        setOrig(data as Record<string, unknown>)
        setDados(data as Record<string, unknown>)
      })
  }, [userId])

  const existe = (k: string) => orig !== null && k in orig

  async function salvar() {
    if (!orig) return
    const mudou: Record<string, unknown> = {}
    for (const [, cs] of CAMPOS_PERFIL)
      for (const c of cs) {
        if (!existe(c.k)) continue
        let v = dados[c.k]
        if (c.tipo === "data")
          v = v ? new Date(`${String(v).slice(0, 10)}T23:59:59-03:00`).toISOString() : null
        if (c.tipo === "lista" && typeof v === "string")
          v = v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        if (c.tipo === "numero") v = v === "" || v == null ? null : Number(v)
        if ((c.tipo ?? "texto") === "texto" || c.tipo === "longo")
          v = typeof v === "string" ? v.trim() || null : v
        const antes =
          c.tipo === "data"
            ? orig[c.k]
              ? new Date(String(orig[c.k])).toISOString()
              : null
            : orig[c.k]
        if (JSON.stringify(v ?? null) !== JSON.stringify(antes ?? null)) mudou[c.k] = v
      }
    if (!Object.keys(mudou).length) return setMsg("Nada foi alterado.")
    const sb = portalBrowserClient()
    if (!sb) return
    setSalvando(true)
    const { error } = await sb.from("perfis").update(mudou).eq("user_id", userId)
    setSalvando(false)
    if (error) return setMsg(`Não foi possível salvar: ${error.message}`)
    onFechar(true)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="my-6 flex w-full max-w-3xl flex-col gap-5 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold">Editar dados do cliente</h2>
            <p className="text-sm text-slate-600">
              A alteração fica na auditoria. O e-mail de login não muda por aqui; para isso, envie a
              troca de senha ou abra um chamado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onFechar(false)}
            className="rounded-full border border-slate-300 px-3 py-1 text-sm font-bold"
          >
            Fechar
          </button>
        </div>
        {!orig && !msg ? <p className="text-slate-600">Carregando...</p> : null}
        {orig
          ? CAMPOS_PERFIL.map(([grupo, cs]) => {
              const vis = cs.filter((c) => existe(c.k))
              if (!vis.length) return null
              return (
                <fieldset key={grupo} className="flex flex-col gap-3">
                  <legend className="mb-2 text-sm font-extrabold tracking-wide text-[var(--brand)] uppercase">
                    {grupo}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {vis.map((c) => {
                      const v = dados[c.k]
                      const set = (nv: unknown) => setDados((d) => ({ ...d, [c.k]: nv }))
                      if (c.tipo === "sim")
                        return (
                          <label key={c.k} className="flex items-center gap-2 text-sm font-bold">
                            <input
                              type="checkbox"
                              checked={!!v}
                              onChange={(e) => set(e.target.checked)}
                            />
                            {c.l}
                          </label>
                        )
                      if (c.tipo === "opcoes")
                        return (
                          <label key={c.k} className={rotulo}>
                            {c.l}
                            <select
                              value={String(v ?? "")}
                              onChange={(e) => set(e.target.value)}
                              className={campo}
                            >
                              {c.opcoes?.map(([ov, ol]) => (
                                <option key={ov} value={ov}>
                                  {ol}
                                </option>
                              ))}
                            </select>
                          </label>
                        )
                      if (c.tipo === "longo")
                        return (
                          <label key={c.k} className={`${rotulo} sm:col-span-2`}>
                            {c.l}
                            <textarea
                              rows={4}
                              value={String(v ?? "")}
                              onChange={(e) => set(e.target.value)}
                              className="rounded-lg border border-slate-300 p-3 font-normal"
                            />
                          </label>
                        )
                      if (c.tipo === "lista")
                        return (
                          <label key={c.k} className={`${rotulo} sm:col-span-2`}>
                            {c.l}
                            <input
                              value={Array.isArray(v) ? v.join(", ") : String(v ?? "")}
                              onChange={(e) => set(e.target.value)}
                              className={campo}
                            />
                          </label>
                        )
                      return (
                        <label key={c.k} className={rotulo}>
                          {c.l}
                          <input
                            type={
                              c.tipo === "data" ? "date" : c.tipo === "numero" ? "number" : "text"
                            }
                            value={c.tipo === "data" ? paraData(v) : String(v ?? "")}
                            onChange={(e) => set(e.target.value)}
                            className={campo}
                          />
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              )
            })
          : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!orig || salvando}
            onClick={salvar}
            className="rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar alterações"}
          </button>
          {msg ? <span className="text-sm font-bold">{msg}</span> : null}
        </div>
      </div>
    </div>
  )
}
