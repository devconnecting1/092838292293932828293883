"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AnuncioProprietario } from "@/components/portal/avulsos"
import { SuporteCliente } from "@/components/portal/gestao"
import { Radar } from "@/components/portal/radar"
import { portalBrowserClient } from "@/lib/portal/browser-client"

/**
 * Porta de entrada depois do login: cada tipo de usuário vai para o próprio painel.
 * CEO e equipe → gestão; corretor, imobiliária e investidor → painel profissional;
 * proprietário → anúncios; comprador → radar, simulações e suporte.
 */
export function MinhaConta() {
  const router = useRouter()
  const [tipo, setTipo] = React.useState<"carregando" | "fora" | "proprietario" | "comprador">(
    "carregando"
  )
  const [nome, setNome] = React.useState("")

  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) {
      const t = setTimeout(() => setTipo("fora"), 0)
      return () => clearTimeout(t)
    }
    void (async () => {
      const { data: u } = await sb.auth.getUser()
      if (!u.user) return router.replace("/corretores/entrar?volta=/minha-conta")
      const { data } = await sb
        .from("perfis")
        .select("perfil, nome")
        .eq("user_id", u.user.id)
        .maybeSingle()
      const p = data as { perfil?: string; nome?: string } | null
      const meta =
        typeof u.user.user_metadata?.tipo === "string" ? (u.user.user_metadata.tipo as string) : ""
      const perfil = p?.perfil ?? meta
      setNome(p?.nome ?? (u.user.user_metadata?.nome as string | undefined) ?? "")
      if (perfil === "admin" || perfil === "atendente") return router.replace("/gestao")
      if (["corretor", "imobiliaria", "investidor"].includes(perfil))
        return router.replace("/corretores/painel")
      setTipo(perfil === "proprietario" ? "proprietario" : "comprador")
    })()
  }, [router])

  async function sair() {
    const sb = portalBrowserClient()
    await sb?.auth.signOut()
    router.push("/")
  }

  if (tipo === "carregando") return <p className="p-10 text-center text-slate-600">Carregando...</p>
  if (tipo === "fora")
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <Link
          href="/corretores/entrar?volta=/minha-conta"
          className="font-bold text-[var(--brand)]"
        >
          Entre na sua conta
        </Link>
      </div>
    )

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
            {tipo === "proprietario" ? "Área do proprietário" : "Minha conta"}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Olá, {nome.split(" ")[0] || "bem-vindo"}
          </h1>
        </div>
        <button
          type="button"
          onClick={sair}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
        >
          Sair
        </button>
      </div>
      {tipo === "proprietario" ? (
        <AnuncioProprietario />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["/simulador", "Como preencher a proposta da Caixa"],
                ["/credito", "Simular meu financiamento"],
                ["/como-funciona/caixa#assessoria", "Pedir assessoria"],
              ] as [string, string][]
            ).map(([h, t]) => (
              <Link
                key={h}
                href={h}
                className="rounded-2xl border border-slate-200 p-5 font-extrabold hover:border-[var(--brand)]"
              >
                {t}
              </Link>
            ))}
          </div>
          <Radar modo="comprador" />
        </>
      )}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5">
        <h2 className="text-xl font-extrabold">Suporte</h2>
        <SuporteCliente />
      </section>
    </div>
  )
}
