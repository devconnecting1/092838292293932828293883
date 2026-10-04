"use client"

import * as React from "react"
import Link from "next/link"

import { DOCS, portalBrowserClient, type Perfil } from "@/lib/portal/browser-client"

type Filtro = "pendente" | "aprovado" | "recusado"

export function CorretorAprovacao() {
  const [admin, setAdmin] = React.useState<boolean | null>(null)
  const [filtro, setFiltro] = React.useState<Filtro>("pendente")
  const [lista, setLista] = React.useState<Perfil[]>([])
  const [links, setLinks] = React.useState<Record<string, string>>({})
  const [msg, setMsg] = React.useState("")

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: a } = await sb.rpc("sou_admin")
    setAdmin(a === true)
    if (a !== true) return
    const { data } = await sb
      .from("perfis")
      .select("*")
      .in("perfil", ["corretor", "investidor"])
      .eq("status", filtro)
      .order("enviado_em", { ascending: true, nullsFirst: false })
    const rows = (data ?? []) as Perfil[]
    setLista(rows)
    const caminhos = rows.flatMap((p) =>
      DOCS.map((d) => p[d.campo]).filter((x): x is string => !!x)
    )
    if (caminhos.length) {
      const { data: urls } = await sb.storage
        .from("corretores-docs")
        .createSignedUrls(caminhos, 600)
      setLinks(
        Object.fromEntries(
          (urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path ?? "", String(u.signedUrl)])
        )
      )
    }
  }, [filtro])

  React.useEffect(() => {
    const t = setTimeout(() => void carregar(), 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function decidir(p: Perfil, status: "aprovado" | "recusado", motivo?: string) {
    const sb = portalBrowserClient()
    if (!sb) return
    const { error } = await sb
      .from("perfis")
      .update({ status, motivo: motivo ?? null })
      .eq("user_id", p.user_id)
    setMsg(
      error
        ? "Não foi possível salvar a decisão."
        : `${p.nome}: ${status === "aprovado" ? "aprovado" : "recusado"}.`
    )
    await carregar()
  }

  if (admin === null) return <p className="text-slate-600">Carregando...</p>
  if (!admin)
    return (
      <p className="rounded-2xl border border-slate-200 p-6">
        Área restrita.{" "}
        <Link href="/corretores/entrar" className="font-bold text-[var(--brand)]">
          Entrar
        </Link>
      </p>
    )

  const fotoUrl = (path: string | null) => {
    if (!path) return null
    const sb = portalBrowserClient()
    return sb?.storage.from("corretores-fotos").getPublicUrl(path).data.publicUrl ?? null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Administração
        </span>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Aprovar corretores</h1>
        <p className="mt-1 text-slate-600">
          Confira o CRECI no site do conselho regional, as certidões e o comprovante de residência
          antes de aprovar.
        </p>
      </div>
      <div className="flex gap-2">
        {(["pendente", "aprovado", "recusado"] as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-lg px-4 py-2 text-sm font-bold capitalize ${filtro === f ? "bg-[var(--brand)] text-white" : "border border-slate-300"}`}
          >
            {f === "pendente" ? "Pendentes" : f === "aprovado" ? "Aprovados" : "Recusados"}
          </button>
        ))}
      </div>
      {msg ? <p className="rounded-lg bg-slate-50 p-3 text-sm font-semibold">{msg}</p> : null}
      {lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
          Nada por aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {lista.map((p) => {
            const foto = fotoUrl(p.foto_path)
            return (
              <li
                key={p.user_id}
                className="grid gap-4 rounded-2xl border border-slate-200 p-5 md:grid-cols-[96px_1fr_auto]"
              >
                {foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={foto} alt="" className="size-24 rounded-xl object-cover" />
                ) : (
                  <div className="size-24 rounded-xl bg-slate-100" />
                )}
                <div className="min-w-0 text-sm">
                  <p className="text-lg font-extrabold">
                    {p.nome}{" "}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 capitalize">
                      {p.perfil}
                    </span>
                  </p>
                  <p>
                    CRECI {p.creci}/{p.creci_uf} · WhatsApp {p.whatsapp} · {p.email}
                  </p>
                  <p className="text-slate-600">
                    {[p.endereco, p.cidade, p.uf].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-slate-500">
                    Página: /corretor/{p.slug} · Enviado em{" "}
                    {p.enviado_em
                      ? new Date(p.enviado_em).toLocaleString("pt-BR")
                      : "ainda não enviou"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {DOCS.map((d) => {
                      const path = p[d.campo]
                      const url = path ? links[path] : null
                      return url ? (
                        <a
                          key={d.campo}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-[var(--brand)]"
                        >
                          {d.rotulo}
                        </a>
                      ) : (
                        <span key={d.campo} className="text-red-700">
                          Falta: {d.rotulo}
                        </span>
                      )
                    })}
                  </div>
                  {p.motivo ? <p className="mt-1 text-red-700">Motivo: {p.motivo}</p> : null}
                </div>
                <div className="flex flex-col gap-2 md:w-40">
                  {p.status !== "aprovado" ? (
                    <button
                      type="button"
                      onClick={() => decidir(p, "aprovado")}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
                    >
                      Aprovar
                    </button>
                  ) : null}
                  <form
                    action={(fd) =>
                      decidir(
                        p,
                        "recusado",
                        String(fd.get("motivo") ?? "").trim() || "Documentação incompleta."
                      )
                    }
                    className="flex flex-col gap-2"
                  >
                    <input
                      name="motivo"
                      placeholder="Motivo (vai para o corretor)"
                      className="h-10 rounded-lg border border-slate-300 px-2 text-sm"
                    />
                    <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700">
                      {p.status === "aprovado" ? "Suspender" : "Recusar"}
                    </button>
                  </form>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
