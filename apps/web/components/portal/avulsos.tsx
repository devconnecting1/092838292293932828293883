"use client"

import * as React from "react"
import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import {
  AUTORIZACAO_VERSAO,
  linkSugestaoTexto,
  ORIGEM_ROTULO,
  TIPOS_AVULSO,
  type Avulso,
} from "@/lib/portal/avulsos"
import { portalBrowserClient } from "@/lib/portal/browser-client"
import { pct as fmtPct, reais } from "@/lib/portal/config-portal"
import { useConfigPortal } from "@/lib/portal/use-config"

const campo = "h-11 rounded-lg border border-slate-300 px-3"
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

function useSessao() {
  const [uid, setUid] = React.useState<string | null | undefined>(undefined)
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) {
      const t = setTimeout(() => setUid(null), 0)
      return () => clearTimeout(t)
    }
    sb.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setUid(s?.user.id ?? null))
    return () => data.subscription.unsubscribe()
  }, [])
  return uid
}

function ContaRapida() {
  const [modo, setModo] = React.useState<"criar" | "entrar">("criar")
  const [msg, setMsg] = React.useState("")
  async function enviar(fd: FormData) {
    setMsg("")
    const sb = portalBrowserClient()
    if (!sb) return
    const email = String(fd.get("email") ?? "")
      .trim()
      .toLowerCase()
    const password = String(fd.get("senha") ?? "")
    if (modo === "entrar") {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) setMsg("E-mail ou senha incorretos.")
      return
    }
    if (password.length < 8) return setMsg("A senha precisa ter pelo menos 8 caracteres.")
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { nome: String(fd.get("nome") ?? ""), tipo: "proprietario" },
        emailRedirectTo: `${window.location.origin}/anuncie-gratis`,
      },
    })
    if (error) return setMsg("Não foi possível criar a conta. Confira o e-mail.")
    if (!data.session)
      setMsg("Conta criada. Confirme pelo link que enviamos ao seu e-mail e volte aqui.")
  }
  return (
    <form action={enviar} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6">
      <h2 className="text-xl font-extrabold">
        {modo === "criar" ? "Crie sua conta grátis" : "Entrar"}
      </h2>
      {modo === "criar" ? (
        <input name="nome" required placeholder="Seu nome" className={campo} />
      ) : null}
      <input name="email" type="email" required placeholder="E-mail" className={campo} />
      <input
        name="senha"
        type="password"
        required
        placeholder="Senha (mínimo 8 caracteres)"
        className={campo}
      />
      {msg ? <p className="text-sm font-bold">{msg}</p> : null}
      <button className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white">
        {modo === "criar" ? "Criar conta e anunciar" : "Entrar"}
      </button>
      <button
        type="button"
        onClick={() => setModo(modo === "criar" ? "entrar" : "criar")}
        className="text-sm font-bold text-[var(--brand)]"
      >
        {modo === "criar" ? "Já tenho conta" : "Criar conta nova"}
      </button>
    </form>
  )
}

type PlanoAvulso = {
  id: string
  codigo: string
  avulso_id: string
  valor: number
  dias: number
  status: "aguardando_pagamento" | "pago" | "ativo" | "expirado" | "cancelado"
  inicio: string | null
  fim: string | null
  renovar: boolean | null
  renovacao_de: string | null
}

const dataBr = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "-")

/** Plano pago que publica o anúncio do proprietário em /imoveis-a-venda. */
function PlanoDoAnuncio({
  avulso,
  planos,
  aoMudar,
}: {
  avulso: Avulso
  planos: PlanoAvulso[]
  aoMudar: () => Promise<void>
}) {
  const cfg = useConfigPortal()
  const [aceite, setAceite] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)
  const [msg, setMsg] = React.useState("")
  const [agora] = React.useState(() => Date.now())
  const ativo = planos
    .filter((p) => p.status === "ativo" && p.fim && new Date(p.fim).getTime() > agora)
    .sort((a, b) => String(b.fim).localeCompare(String(a.fim)))[0]
  const aberto = planos.find((p) => p.status === "aguardando_pagamento")
  const pago = planos.find((p) => p.status === "pago")
  const renovado = ativo
    ? planos.some((p) => p.renovacao_de === ativo.id && p.status !== "cancelado")
    : false
  const diasRestantes = ativo?.fim
    ? Math.ceil((new Date(ativo.fim).getTime() - agora) / 86400000)
    : null

  async function pagar() {
    setMsg("")
    const sb = portalBrowserClient()
    const s = sb ? (await sb.auth.getSession()).data.session : null
    if (!s) return
    setEnviando(true)
    try {
      const r = await fetch("/api/portal/anuncios/plano-proprietario", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ avulsoId: avulso.id }),
      })
      const j = (await r.json()) as { url?: string; aviso?: string; erro?: string }
      if (j.url) window.location.href = j.url
      else setMsg(j.aviso ?? j.erro ?? "Não foi possível abrir o pagamento.")
      await aoMudar()
    } catch {
      setMsg("Sem conexão agora. Tente de novo.")
    } finally {
      setEnviando(false)
    }
  }

  async function naoRenovar(id: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    await sb.rpc("responder_renovacao_avulso", { p_plano: id, p_renovar: false })
    setMsg("Combinado. O anúncio sai do site 2 dias depois do fim do plano.")
    await aoMudar()
  }

  const caixa = "rounded-lg bg-slate-50 p-3"
  if (ativo)
    return (
      <div className={caixa}>
        <p>
          <b className="text-emerald-800">No site para compradores</b> até {dataBr(ativo.fim)} (
          {ativo.codigo}).{" "}
          <Link href="/imoveis-a-venda" className="font-bold text-[var(--brand)]">
            Ver no site
          </Link>
        </p>
        {renovado ? (
          <p className="mt-1 text-slate-600">
            Renovação contratada: o novo período começa no fim deste.
          </p>
        ) : diasRestantes !== null && diasRestantes <= 10 && ativo.renovar === null ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span>
              Faltam {diasRestantes} dias. Renovar por mais {cfg.plano_anuncio_proprietario.dias}{" "}
              dias?
            </span>
            <button
              type="button"
              disabled={enviando}
              onClick={pagar}
              className="rounded-full bg-[var(--brand)] px-4 py-1.5 font-bold text-white"
            >
              Sim, renovar ({reais(cfg.plano_anuncio_proprietario.preco)})
            </button>
            <button
              type="button"
              onClick={() => naoRenovar(ativo.id)}
              className="rounded-full border border-slate-300 px-4 py-1.5 font-bold"
            >
              Não renovar
            </button>
          </div>
        ) : ativo.renovar === false ? (
          <p className="mt-1 text-slate-600">Você escolheu não renovar.</p>
        ) : null}
        {msg ? <p className="mt-1 font-bold">{msg}</p> : null}
      </div>
    )
  if (pago)
    return (
      <div className={caixa}>
        <b>Plano pago ({pago.codigo}).</b> O anúncio entra no site assim que for aprovado pela
        equipe, e os {pago.dias} dias começam a contar a partir daí.
      </div>
    )
  return (
    <div className={`${caixa} flex flex-col gap-2`}>
      <p>
        <b>
          {avulso.finalidade === "aluguel"
            ? "Publicar para interessados?"
            : "Quer vender sem corretor?"}
        </b>{" "}
        Publique este imóvel no site por{" "}
        {reais(aberto?.valor ?? cfg.plano_anuncio_proprietario.preco)} durante{" "}
        {aberto?.dias ?? cfg.plano_anuncio_proprietario.dias} dias. Os dias só começam a contar com
        o anúncio aprovado.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={aceite}
          onChange={(e) => setAceite(e.target.checked)}
          className="mt-1"
        />
        <span>
          Autorizo mostrar no anúncio público o nome e o telefone de contato que informei (
          {avulso.contato_nome}, {avulso.contato_telefone}). O endereço completo não aparece.
        </span>
      </label>
      <button
        type="button"
        disabled={!aceite || enviando}
        onClick={pagar}
        className="self-start rounded-full bg-[var(--brand)] px-5 py-2 font-bold text-white disabled:opacity-50"
      >
        {enviando ? "Abrindo..." : aberto ? `Pagar pedido ${aberto.codigo}` : "Contratar e pagar"}
      </button>
      {msg ? <p className="font-bold">{msg}</p> : null}
    </div>
  )
}

/** Cadastro do anúncio grátis pelo proprietário. */
export function AnuncioProprietario() {
  const cfg = useConfigPortal()
  const uid = useSessao()
  const [meus, setMeus] = React.useState<Avulso[]>([])
  const [planos, setPlanos] = React.useState<PlanoAvulso[]>([])
  const [status, setStatus] = React.useState<"" | "enviando" | "ok" | "erro">("")
  const [erro, setErro] = React.useState("")
  const [aceitaCorretor, setAceitaCorretor] = React.useState(true)
  const [finalidade, setFinalidade] = React.useState<"venda" | "aluguel">("venda")
  const [dados, setDados] = React.useState({
    tipo: "Apartamento",
    bairro: "",
    cidade: "",
    quartos: "",
    area: "",
  })

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb || !uid) return
    const { data } = await sb
      .from("imoveis_avulsos")
      .select("*")
      .eq("dono_id", uid)
      .order("criado", { ascending: false })
    setMeus((data as Avulso[] | null) ?? [])
    const { data: pl } = await sb
      .from("avulsos_planos")
      .select("id, codigo, avulso_id, valor, dias, status, inicio, fim, renovar, renovacao_de")
      .eq("user_id", uid)
      .order("criado", { ascending: false })
    setPlanos((pl as PlanoAvulso[] | null) ?? [])
  }, [uid])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function enviar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb || !uid) return
    setErro("")
    setStatus("enviando")
    try {
      const fotos: string[] = []
      for (const f of fd.getAll("fotos")) {
        if (!(f instanceof File) || !f.size) continue
        if (!["image/jpeg", "image/png", "image/webp"].includes(f.type) || f.size > 5 * 1024 * 1024)
          throw new Error(`Foto não aceita: ${f.name} (JPG, PNG ou WEBP até 5 MB).`)
        const path = `${uid}/${Date.now()}-${fotos.length}.${f.type.split("/")[1]}`
        const { error } = await sb.storage
          .from("avulsos-fotos")
          .upload(path, f, { contentType: f.type })
        if (error) throw new Error("Não foi possível enviar as fotos.")
        fotos.push(sb.storage.from("avulsos-fotos").getPublicUrl(path).data.publicUrl)
        if (fotos.length >= 20) break
      }
      if (fotos.length < 3) throw new Error("Envie pelo menos 3 fotos.")
      const n = (k: string) => {
        const v = Number(
          String(fd.get(k) ?? "")
            .replace(/\./g, "")
            .replace(",", ".")
        )
        return Number.isFinite(v) && v > 0 ? v : null
      }
      const { error } = await sb.from("imoveis_avulsos").insert({
        dono_id: uid,
        origem: "proprietario",
        tipo: dados.tipo,
        titulo: String(fd.get("titulo") ?? "").trim(),
        descricao: String(fd.get("descricao") ?? "").trim(),
        preco: n("preco"),
        uf: String(fd.get("uf") ?? ""),
        cidade: dados.cidade.trim(),
        bairro: dados.bairro.trim() || null,
        endereco: String(fd.get("endereco") ?? "").trim() || null,
        quartos: n("quartos"),
        vagas: n("vagas"),
        area: n("area"),
        fotos,
        contato_nome: String(fd.get("contato_nome") ?? "").trim(),
        contato_telefone: String(fd.get("contato_telefone") ?? "").trim(),
        aceita_corretor: finalidade === "venda" ? aceitaCorretor : false,
        finalidade,
        valor_condominio: n("valor_condominio"),
        valor_iptu: n("valor_iptu"),
        autorizacao_versao: AUTORIZACAO_VERSAO,
        autorizacao_aceite_em: new Date().toISOString(),
      })
      if (error)
        throw new Error(
          "Não foi possível salvar. Confira título (10+ letras), descrição (30+) e preço."
        )
      setStatus("ok")
      await carregar()
    } catch (e) {
      setStatus("erro")
      setErro(e instanceof Error ? e.message : "Erro ao enviar.")
    }
  }

  if (uid === undefined) return <p className="text-slate-600">Carregando...</p>
  if (!uid) return <ContaRapida />

  return (
    <div className="flex flex-col gap-6">
      {meus.length ? (
        <section id="meus-anuncios" className="flex scroll-mt-24 flex-col gap-2">
          <h2 className="text-xl font-extrabold">Meus anúncios</h2>
          {meus.map((a) => (
            <div
              key={a.id}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <b>{a.titulo}</b>
                <span>
                  {brl(a.preco)}
                  {a.finalidade === "aluguel" ? "/mês (aluguel)" : ""} ·{" "}
                  {
                    {
                      pendente: "aguardando aprovação",
                      aprovado: "no ar para os corretores",
                      recusado: `recusado${a.motivo ? `: ${a.motivo}` : ""}`,
                      vendido: "vendido",
                      pausado: "pausado",
                    }[a.status]
                  }
                </span>
              </div>
              {a.status !== "recusado" && a.status !== "vendido" ? (
                <PlanoDoAnuncio
                  avulso={a}
                  planos={planos.filter((p) => p.avulso_id === a.id)}
                  aoMudar={carregar}
                />
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {status === "ok" ? (
        <p className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
          Anúncio enviado. Depois da aprovação ele vai para a vitrine dos corretores parceiros.
        </p>
      ) : (
        <form
          action={enviar}
          className="flex flex-col gap-5 rounded-2xl border border-slate-200 p-6"
        >
          <div className="flex gap-1 self-start rounded-full border border-slate-300 p-1">
            {(
              [
                ["venda", "Quero vender"],
                ["aluguel", "Quero alugar"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFinalidade(v)}
                className={`rounded-full px-5 py-2 text-sm font-bold ${finalidade === v ? "bg-[var(--brand)] text-white" : "text-slate-700"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-extrabold">O imóvel</legend>
            <select
              value={dados.tipo}
              onChange={(e) => setDados({ ...dados, tipo: e.target.value })}
              className={`${campo} bg-white`}
            >
              {TIPOS_AVULSO.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input
              name="preco"
              required
              inputMode="numeric"
              placeholder={finalidade === "venda" ? "Preço de venda (R$)" : "Aluguel por mês (R$)"}
              className={campo}
            />
            {finalidade === "aluguel" ? (
              <>
                <input
                  name="valor_condominio"
                  inputMode="numeric"
                  placeholder="Condomínio por mês (R$, opcional)"
                  className={campo}
                />
                <input
                  name="valor_iptu"
                  inputMode="numeric"
                  placeholder="IPTU por mês (R$, opcional)"
                  className={campo}
                />
              </>
            ) : null}
            <input
              value={dados.cidade}
              onChange={(e) => setDados({ ...dados, cidade: e.target.value })}
              required
              placeholder="Cidade"
              className={campo}
            />
            <select name="uf" defaultValue="RJ" className={`${campo} bg-white`}>
              {BRAZILIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              value={dados.bairro}
              onChange={(e) => setDados({ ...dados, bairro: e.target.value })}
              required
              placeholder="Bairro"
              className={campo}
            />
            <input name="endereco" placeholder="Endereço (só corretores veem)" className={campo} />
            <input
              value={dados.quartos}
              onChange={(e) => setDados({ ...dados, quartos: e.target.value })}
              name="quartos"
              inputMode="numeric"
              placeholder="Quartos"
              className={campo}
            />
            <input name="vagas" inputMode="numeric" placeholder="Vagas" className={campo} />
            <input
              value={dados.area}
              onChange={(e) => setDados({ ...dados, area: e.target.value })}
              name="area"
              inputMode="numeric"
              placeholder="Área (m²)"
              className={campo}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-extrabold">Texto do anúncio</legend>
            <a
              href={linkSugestaoTexto(dados)}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start rounded-lg border-[1.5px] border-[var(--brand)] px-4 py-2 text-sm font-bold text-[var(--brand)]"
            >
              Pedir sugestão de texto ao ChatGPT
            </a>
            <input
              name="titulo"
              required
              minLength={10}
              maxLength={120}
              placeholder="Título (ex.: Apartamento 2 quartos com vaga no Centro)"
              className={campo}
            />
            <textarea
              name="descricao"
              required
              minLength={30}
              maxLength={4000}
              rows={5}
              placeholder="Descrição"
              className="rounded-lg border border-slate-300 p-3"
            />
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-extrabold">Fotos (de 3 a 20)</legend>
            <input
              name="fotos"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="text-sm"
            />
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-extrabold">Contato</legend>
            <input
              name="contato_nome"
              required
              placeholder="Nome do proprietário"
              className={campo}
            />
            <input
              name="contato_telefone"
              required
              inputMode="tel"
              placeholder="WhatsApp com DDD"
              className={campo}
            />
          </fieldset>
          {finalidade === "venda" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-extrabold">Como você quer vender</legend>
              <label className="block text-sm">
                <input
                  type="radio"
                  checked={aceitaCorretor}
                  onChange={() => setAceitaCorretor(true)}
                  className="mr-2"
                />
                Grátis, com os corretores parceiros (comissão de {fmtPct(cfg.comissao_avulso.total)}{" "}
                só se eles venderem)
              </label>
              <label className="block text-sm">
                <input
                  type="radio"
                  checked={!aceitaCorretor}
                  onChange={() => setAceitaCorretor(false)}
                  className="mr-2"
                />
                Sem corretor: anunciar direto para compradores no site (plano de{" "}
                {reais(cfg.plano_anuncio_proprietario.preco)} por{" "}
                {cfg.plano_anuncio_proprietario.dias} dias, contratado depois do envio)
              </label>
            </fieldset>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-sm">
              Aluguel é anunciado direto para os interessados no site, com o plano de{" "}
              {reais(cfg.plano_anuncio_proprietario.preco)} por{" "}
              {cfg.plano_anuncio_proprietario.dias} dias, contratado depois do envio.
            </p>
          )}
          <label className="block text-xs leading-relaxed text-slate-700">
            <input type="checkbox" required className="mr-2 inline size-4 align-[-3px]" />
            Li e aceito a{" "}
            <Link href="/autorizacao-de-venda" target="_blank" className="font-bold underline">
              Autorização de Venda e o termo de privacidade
            </Link>{" "}
            (versão {AUTORIZACAO_VERSAO}). Meu aceite fica registrado com data e hora.
          </label>
          {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
          <button
            disabled={status === "enviando"}
            className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
          >
            {status === "enviando" ? "Enviando..." : "Enviar anúncio para aprovação"}
          </button>
        </form>
      )}
    </div>
  )
}

/** Vitrine dos imóveis avulsos para corretores parceiros aprovados (o RLS filtra). */
export function VitrineAvulsos({ admin = false }: { admin?: boolean }) {
  const [itens, setItens] = React.useState<Avulso[] | null>(null)
  const [filtro, setFiltro] = React.useState("")
  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return setItens([])
    let q = sb.from("imoveis_avulsos").select("*").order("criado", { ascending: false }).limit(200)
    q = admin ? q.eq("status", "pendente") : q.eq("status", "aprovado")
    const { data } = await q
    setItens((data as Avulso[] | null) ?? [])
  }, [admin])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function decidir(id: string, status: "aprovado" | "recusado") {
    const sb = portalBrowserClient()
    if (!sb) return
    const motivo = status === "recusado" ? "Ajuste fotos ou texto e envie de novo." : null
    await sb.from("imoveis_avulsos").update({ status, motivo }).eq("id", id)
    await carregar()
  }

  if (itens === null) return <p className="text-slate-600">Carregando...</p>
  const f = filtro.trim().toLowerCase()
  const lista = f
    ? itens.filter((i) => `${i.cidade} ${i.bairro ?? ""} ${i.tipo}`.toLowerCase().includes(f))
    : itens
  return (
    <div className="flex flex-col gap-4">
      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtrar por cidade, bairro ou tipo"
        className={campo}
      />
      {lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
          {admin
            ? "Nenhum anúncio esperando aprovação."
            : "Nenhum imóvel avulso disponível para você agora."}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {lista.map((a) => (
          <article
            key={a.id}
            className="flex flex-col gap-2 overflow-hidden rounded-2xl border border-slate-200"
          >
            {a.fotos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.fotos[0]} alt={a.titulo} className="h-44 w-full object-cover" />
            ) : null}
            <div className="flex flex-col gap-1 p-4 text-sm">
              <span className="text-xs font-bold text-slate-500 uppercase">
                {ORIGEM_ROTULO[a.origem]}
              </span>
              <b className="text-base">{a.titulo}</b>
              <span>{[a.bairro, `${a.cidade}/${a.uf}`].filter(Boolean).join(" · ")}</span>
              <span className="text-lg font-extrabold">{brl(a.preco)}</span>
              <span className="text-slate-600">
                {a.descricao.slice(0, 220)}
                {a.descricao.length > 220 ? "..." : ""}
              </span>
              {a.endereco ? (
                <span>
                  <b>Endereço:</b> {a.endereco}
                </span>
              ) : null}
              <span>
                <b>Proprietário:</b> {a.contato_nome} · {a.contato_telefone}
              </span>
              <span className="text-emerald-800">
                Comissão de {fmtPct(a.comissao_total)} ({fmtPct(a.comissao_corretor ?? 4)} para
                você, {fmtPct(a.comissao_plataforma ?? 2)} para a plataforma)
              </span>
              {a.fotos.length > 1 ? (
                <details>
                  <summary className="cursor-pointer font-bold">Ver {a.fotos.length} fotos</summary>
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {a.fotos.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" className="h-20 w-full rounded object-cover" />
                    ))}
                  </div>
                </details>
              ) : null}
              {admin ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => decidir(a.id, "aprovado")}
                    className="rounded-lg bg-emerald-600 py-2 font-bold text-white"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    onClick={() => decidir(a.id, "recusado")}
                    className="rounded-lg border border-slate-300 py-2 font-bold"
                  >
                    Recusar
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
