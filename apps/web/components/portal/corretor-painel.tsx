"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import {
  EnderecoCampos,
  LgpdAceite,
  lerTelefones,
  TelefonesCampos,
} from "@/components/portal/campos-cadastro"
import { AreaAtendimento, LeadsRodizio } from "@/components/portal/leads-rodizio"
import { PlanoAtual } from "@/components/portal/plano-atual"
import { MinhaPublicidade } from "@/components/portal/publicidade"
import {
  DOCS,
  PARCERIA_VERSAO,
  portalBrowserClient,
  REDES,
  slugDe,
  type Perfil,
} from "@/lib/portal/browser-client"

const campo = "h-11 rounded-lg border border-slate-300 px-3"
const TIPOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"]

function extensao(f: File) {
  return f.type === "application/pdf" ? "pdf" : f.type.split("/")[1] || "jpg"
}

export function CorretorPainel() {
  const router = useRouter()
  const [perfil, setPerfil] = React.useState<Perfil | null>(null)
  const [uid, setUid] = React.useState<string | null>(null)
  const [tipoMeta, setTipoMeta] = React.useState<string | null>(null)
  const [metaTel, setMetaTel] = React.useState<{
    t1?: string | null
    w1?: boolean | null
    t2?: string | null
    w2?: boolean | null
  }>({})
  const [admin, setAdmin] = React.useState(false)
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState("")
  const [ok, setOk] = React.useState("")
  const [salvando, setSalvando] = React.useState(false)
  const [editando, setEditando] = React.useState(false)

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: u } = await sb.auth.getUser()
    if (!u.user) {
      router.replace("/corretores/entrar")
      return
    }
    setUid(u.user.id)
    setTipoMeta(typeof u.user.user_metadata?.tipo === "string" ? u.user.user_metadata.tipo : null)
    const md = (u.user.user_metadata ?? {}) as Record<string, unknown>
    setMetaTel({
      t1: typeof md.telefone_1 === "string" ? md.telefone_1 : null,
      w1: typeof md.telefone_1_whats === "boolean" ? md.telefone_1_whats : null,
      t2: typeof md.telefone_2 === "string" ? md.telefone_2 : null,
      w2: typeof md.telefone_2_whats === "boolean" ? md.telefone_2_whats : null,
    })
    const [{ data: p }, { data: a }] = await Promise.all([
      sb.from("perfis").select("*").eq("user_id", u.user.id).maybeSingle(),
      sb.rpc("sou_admin"),
    ])
    setPerfil((p as Perfil | null) ?? null)
    setAdmin(a === true)
    setCarregando(false)
  }, [router])

  React.useEffect(() => {
    const t = setTimeout(() => void carregar(), 0)
    return () => clearTimeout(t)
  }, [carregar])

  const tipo: "corretor" | "investidor" =
    perfil?.perfil === "investidor" || (!perfil && tipoMeta === "investidor")
      ? "investidor"
      : "corretor"
  const ehImobiliaria = perfil?.perfil === "imobiliaria" || (!perfil && tipoMeta === "imobiliaria")

  async function salvar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb || !uid) return
    setErro("")
    setOk("")
    setSalvando(true)
    try {
      const nome = String(fd.get("nome") ?? "").trim()
      const linha: Record<string, unknown> = {
        user_id: uid,
        ...(admin ? {} : { perfil: ehImobiliaria ? "imobiliaria" : tipo, creci_ok: false }),
        nome,
        creci: String(fd.get("creci") ?? "").trim(),
        creci_uf: String(fd.get("creci_uf") ?? ""),
        ...lerTelefones(fd),
        cep: String(fd.get("cep") ?? "").replace(/\D/g, "") || null,
        numero: String(fd.get("numero") ?? "").trim() || null,
        complemento: String(fd.get("complemento") ?? "").trim() || null,
        bairro: String(fd.get("bairro") ?? "").trim() || null,
        ...(perfil?.lgpd_aceite_em ? {} : { lgpd_aceite_em: new Date().toISOString() }),
        endereco: String(fd.get("endereco") ?? "").trim(),
        cidade: String(fd.get("cidade") ?? "").trim(),
        uf: String(fd.get("uf") ?? "")
          .toUpperCase()
          .slice(0, 2),
        slug: slugDe(String(fd.get("slug") ?? "") || nome),
        aceite_termos: new Date().toISOString(),
        enviado_em: new Date().toISOString(),
        pix_chave: String(fd.get("pix_chave") ?? "").trim() || null,
        banco: {
          banco: String(fd.get("banco_nome") ?? "").trim(),
          agencia: String(fd.get("banco_agencia") ?? "").trim(),
          conta: String(fd.get("banco_conta") ?? "").trim(),
        },
        redes: Object.fromEntries(
          REDES.map(([k]): [string, string] => [
            k,
            String(fd.get(`rede_${k}`) ?? "").trim(),
          ]).filter(([, v]) => /^https:\/\/\S+$/.test(v))
        ),
        ...(fd.get("parceria") === "on" && !perfil?.parceria_aceite_em
          ? { parceria_versao: PARCERIA_VERSAO, parceria_aceite_em: new Date().toISOString() }
          : {}),
      }
      const envios: [string, string, File][] = []
      const foto = fd.get("foto")
      if (foto instanceof File && foto.size) envios.push(["corretores-fotos", "foto_path", foto])
      for (const d of DOCS) {
        const f = fd.get(d.campo)
        if (f instanceof File && f.size) envios.push(["corretores-docs", d.campo, f])
      }
      for (const [bucket, col, f] of envios) {
        if (
          !TIPOS.includes(f.type) ||
          (bucket === "corretores-fotos" && f.type === "application/pdf")
        ) {
          throw new Error(`Arquivo em formato não aceito: ${f.name}`)
        }
        if (f.size > (bucket === "corretores-fotos" ? 3 : 10) * 1024 * 1024) {
          throw new Error(`Arquivo grande demais: ${f.name}`)
        }
        const path = `${uid}/${col.replace(/_path$/, "")}-${Date.now()}.${extensao(f)}`
        const { error } = await sb.storage
          .from(bucket)
          .upload(path, f, { upsert: false, contentType: f.type })
        if (error) throw new Error(`Não foi possível enviar ${f.name}.`)
        linha[col] = path
      }
      const faltando = (
        tipo === "corretor"
          ? DOCS
          : DOCS.filter(
              (d) => d.campo === "doc_residencia_path" || d.campo === "doc_identidade_path"
            )
      ).filter((d) => !linha[d.campo] && !perfil?.[d.campo])
      if (!linha.foto_path && !perfil?.foto_path)
        throw new Error("Envie a sua foto (ou a logo da imobiliária).")
      if (faltando.length)
        throw new Error(`Falta enviar: ${faltando.map((d) => d.rotulo).join(", ")}.`)
      const { error } = await sb.from("perfis").upsert(linha)
      if (error) {
        throw new Error(
          error.message.includes("perfis_slug_unico")
            ? "Esse endereço de página já está em uso. Escolha outro."
            : "Não foi possível salvar. Confira os campos."
        )
      }
      setOk("Cadastro enviado. A nossa equipe confere os documentos e libera o seu Selo Verde.")
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.")
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return <p className="text-slate-600">Carregando...</p>

  const status = perfil?.status ?? "pendente"
  const enviado = !!perfil?.enviado_em
  const selo =
    status === "aprovado"
      ? {
          cor: "bg-emerald-50 text-emerald-800 border-emerald-200",
          t: "Selo Verde ativo. Seu acesso está liberado.",
        }
      : status === "recusado"
        ? {
            cor: "bg-red-50 text-red-800 border-red-200",
            t: `Cadastro não aprovado. ${perfil?.motivo ?? ""} Corrija e envie de novo.`,
          }
        : enviado
          ? {
              cor: "bg-amber-50 text-amber-900 border-amber-200",
              t: "Documentos recebidos. Aguardando a aprovação da nossa equipe.",
            }
          : {
              cor: "bg-slate-50 text-slate-700 border-slate-200",
              t: "Complete o cadastro e envie os documentos para receber o Selo Verde.",
            }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
            Painel do corretor
          </span>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
            {perfil?.nome || "Seu cadastro"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {admin ? (
            <Link
              href="/gestao"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white"
            >
              Gestão (CEO)
            </Link>
          ) : null}
          {admin ? (
            <Link
              href="/corretores/aprovar"
              className="rounded-lg bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white"
            >
              Aprovar corretores
            </Link>
          ) : null}
          {admin ? (
            <Link
              href="/corretores/importar"
              className="rounded-lg border border-[var(--brand)] px-4 py-2.5 text-sm font-bold text-[var(--brand)]"
            >
              Atualizar imóveis
            </Link>
          ) : null}
          {admin ? (
            <Link
              href="/corretores/aprovar-anuncios"
              className="rounded-lg border border-[var(--brand)] px-4 py-2.5 text-sm font-bold text-[var(--brand)]"
            >
              Aprovar anúncios
            </Link>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await portalBrowserClient()?.auth.signOut()
              router.push("/corretores/entrar")
            }}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold"
          >
            Sair
          </button>
        </div>
      </div>

      <p className={`rounded-2xl border p-4 font-semibold ${selo.cor}`}>{selo.t}</p>

      <PlanoAtual plano={perfil?.plano ?? null} ate={perfil?.plano_ate ?? null} />

      {status === "aprovado" &&
      uid &&
      (perfil?.perfil === "corretor" || perfil?.perfil === "imobiliaria" || admin) ? (
        <>
          <LeadsRodizio uid={uid} />
          <MinhaPublicidade />
          <AreaAtendimento
            uid={uid}
            cidade={perfil?.cidade ?? null}
            uf={perfil?.uf ?? null}
            bairros={perfil?.bairros_atuacao ?? []}
            recebe={perfil?.recebe_leads ?? true}
          />
        </>
      ) : null}

      {status === "aprovado" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Buscar imóveis", "/leiloes"],
              ["Anunciar nos portais", "/anunciar"],
              ["Kit de anúncio para redes", "/corretores/kit"],
              ["Imóveis avulsos", "/corretores/imoveis-avulsos"],
              ["Processos, CPF e certidões", "/processos"],
              ["Suporte e chamados", "/suporte"],
              ["Minha página", perfil?.slug ? `/corretor/${perfil.slug}` : "/corretores/painel"],
            ] as [string, string][]
          ).map(([t, h]) => (
            <Link
              key={t}
              href={h}
              className="rounded-2xl border border-slate-200 p-5 font-extrabold hover:border-[var(--brand)]"
            >
              {t}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className="rounded-2xl border border-dashed border-slate-300 p-5 text-left font-extrabold"
          >
            {editando ? "Fechar edição" : "Editar meus dados, redes e PIX"}
          </button>
        </div>
      ) : null}
      {status !== "aprovado" || editando ? (
        <form
          action={salvar}
          className="flex flex-col gap-5 rounded-2xl border border-slate-200 p-6"
        >
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-extrabold">
              {tipo === "corretor" ? "Dados profissionais" : "Dados do investidor"}
            </legend>
            <input
              name="nome"
              required
              defaultValue={perfil?.nome ?? ""}
              placeholder="Nome completo"
              className={`${campo} sm:col-span-2`}
            />
            {tipo === "corretor" ? (
              <>
                <input
                  name="creci"
                  required
                  defaultValue={perfil?.creci ?? ""}
                  placeholder={
                    ehImobiliaria ? "CRECI jurídico (PJ) da imobiliária" : "Número do CRECI"
                  }
                  className={campo}
                />
                <select
                  name="creci_uf"
                  required
                  defaultValue={perfil?.creci_uf ?? "RJ"}
                  className={`${campo} bg-white`}
                >
                  {BRAZILIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      CRECI de {s.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <div className="sm:col-span-2">
              <TelefonesCampos
                inicial={{
                  t1: perfil?.telefone_1 ?? metaTel.t1 ?? perfil?.whatsapp,
                  w1: perfil?.telefone_1_whats ?? metaTel.w1,
                  t2: perfil?.telefone_2 ?? metaTel.t2 ?? perfil?.recado_1,
                  w2: perfil?.telefone_2_whats ?? metaTel.w2,
                }}
              />
            </div>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Endereço da sua página
              <span className="flex items-center gap-1 text-slate-500">
                /corretor/
                <input
                  name="slug"
                  defaultValue={perfil?.slug ?? ""}
                  placeholder="seunome"
                  className={`${campo} flex-1`}
                />
              </span>
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-extrabold">Endereço</legend>
            <EnderecoCampos
              inicial={{
                cep: perfil?.cep ?? "",
                endereco: perfil?.endereco ?? "",
                numero: perfil?.numero ?? "",
                complemento: perfil?.complemento ?? "",
                bairro: perfil?.bairro ?? "",
                cidade: perfil?.cidade ?? "",
                uf: perfil?.uf ?? "",
              }}
            />
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-extrabold">Dados para pagamento</legend>
            <input
              name="pix_chave"
              required={tipo === "corretor"}
              defaultValue={perfil?.pix_chave ?? ""}
              placeholder="Chave PIX (para receber comissões)"
              className={`${campo} sm:col-span-2`}
            />
            <input
              name="banco_nome"
              defaultValue={perfil?.banco?.banco ?? ""}
              placeholder="Banco"
              className={campo}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                name="banco_agencia"
                defaultValue={perfil?.banco?.agencia ?? ""}
                placeholder="Agência"
                className={campo}
              />
              <input
                name="banco_conta"
                defaultValue={perfil?.banco?.conta ?? ""}
                placeholder="Conta"
                className={campo}
              />
            </div>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-extrabold">Redes sociais profissionais</legend>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Só perfis profissionais, com link completo começando com https://. Perfil pessoal não
              é aceito.
            </p>
            {REDES.map(([k, l]) => (
              <input
                key={k}
                name={`rede_${k}`}
                type="url"
                defaultValue={perfil?.redes?.[k] ?? ""}
                placeholder={l}
                className={campo}
              />
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-extrabold">
              {tipo === "corretor"
                ? "Foto ou logo e documentos do Selo Verde"
                : "Foto ou logo e comprovante de residência"}
            </legend>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Sua foto ou logo (aparece na sua página e nos anúncios)
              <input
                name="foto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="text-sm"
              />
            </label>
            {(tipo === "corretor"
              ? DOCS
              : DOCS.filter(
                  (d) => d.campo === "doc_residencia_path" || d.campo === "doc_identidade_path"
                )
            ).map((d) => (
              <label
                key={d.campo}
                className="flex flex-col gap-1 text-sm font-semibold text-slate-700"
              >
                {d.rotulo}{" "}
                {perfil?.[d.campo] ? (
                  <span className="text-emerald-700">
                    (já enviado; envie de novo só para trocar)
                  </span>
                ) : null}
                <input
                  name={d.campo}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="text-sm"
                />
              </label>
            ))}
            <p className="text-xs leading-relaxed text-slate-500">
              Os documentos ficam em área privada e só a equipe de aprovação vê. Servem apenas para
              conferir o Selo Verde, conforme a Política de Privacidade.
            </p>
          </fieldset>
          {tipo === "corretor" ? (
            <label className="block rounded-xl border border-[var(--brand)] bg-[var(--brand-soft)] p-4 text-sm leading-relaxed">
              <input
                type="checkbox"
                name="parceria"
                defaultChecked={!!perfil?.parceria_aceite_em}
                disabled={!!perfil?.parceria_aceite_em}
                className="mr-2 inline size-4 align-[-3px]"
              />
              {perfil?.parceria_aceite_em
                ? `Contrato de parceria aceito em ${new Date(perfil.parceria_aceite_em).toLocaleDateString("pt-BR")}. `
                : "Li e aceito o "}
              <Link href="/parceria-corretor" target="_blank" className="font-bold underline">
                Contrato de Parceria do Corretor
              </Link>
              . Corretor parceiro aprovado não paga mensalidade.
            </label>
          ) : null}
          {perfil?.lgpd_aceite_em ? null : <LgpdAceite />}
          <label className="block text-xs leading-relaxed text-slate-700">
            <input type="checkbox" required className="mr-2 inline size-4 align-[-3px]" />
            Declaro que as informações são verdadeiras e que sou o único responsável técnico pelas
            intermediações que eu fizer pelo portal, salvo parceria formal com a empresa.
          </label>
          {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
          {ok ? (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{ok}</p>
          ) : null}
          <button
            disabled={salvando}
            className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
          >
            {salvando ? "Enviando..." : "Enviar para aprovação"}
          </button>
        </form>
      ) : null}
    </div>
  )
}
