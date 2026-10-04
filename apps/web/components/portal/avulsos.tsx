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

/** Cadastro do anúncio grátis pelo proprietário. */
export function AnuncioProprietario() {
  const uid = useSessao()
  const [meus, setMeus] = React.useState<Avulso[]>([])
  const [status, setStatus] = React.useState<"" | "enviando" | "ok" | "erro">("")
  const [erro, setErro] = React.useState("")
  const [aceitaCorretor, setAceitaCorretor] = React.useState(true)
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
        aceita_corretor: aceitaCorretor,
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
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-extrabold">Meus anúncios</h2>
          {meus.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm"
            >
              <b>{a.titulo}</b>
              <span>
                {brl(a.preco)} ·{" "}
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
              placeholder="Preço de venda (R$)"
              className={campo}
            />
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
            <legend className="mb-2 font-extrabold">Contato (só corretores veem)</legend>
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-extrabold">Como você quer vender</legend>
            <label className="block text-sm">
              <input
                type="radio"
                checked={aceitaCorretor}
                onChange={() => setAceitaCorretor(true)}
                className="mr-2"
              />
              Grátis, com os corretores parceiros (comissão de 6% só se eles venderem)
            </label>
            <label className="block text-sm">
              <input
                type="radio"
                checked={!aceitaCorretor}
                onChange={() => setAceitaCorretor(false)}
                className="mr-2"
              />
              Sem corretor: quero o plano de anúncio pago (a equipe entra em contato)
            </label>
          </fieldset>
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
                Comissão de {a.comissao_total}% (4% para você, 2% para a plataforma)
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
