"use client"

import * as React from "react"
import Link from "next/link"

import { AdCartToggle } from "@/components/portal/ad-cart"
import { portalBrowserClient } from "@/lib/portal/browser-client"

/** Situação do visitante na área do corretor (sessão própria do portal). */
export function useCorretorAprovado() {
  const [estado, setEstado] = React.useState<"carregando" | "fora" | "pendente" | "aprovado">(
    "carregando"
  )
  React.useEffect(() => {
    let vivo = true
    const t = setTimeout(async () => {
      const sb = portalBrowserClient()
      const { data: u } = (await sb?.auth.getUser()) ?? { data: { user: null } }
      if (!u.user) return vivo && setEstado("fora")
      const [{ data: p }, { data: a }] = await Promise.all([
        sb!.from("perfis").select("status").eq("user_id", u.user.id).maybeSingle(),
        sb!.rpc("sou_admin"),
      ])
      if (vivo) setEstado(a === true || p?.status === "aprovado" ? "aprovado" : "pendente")
    }, 0)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [])
  return estado
}

/** Botões de anúncio que só aparecem para corretor aprovado ou administrador. */
export function CorretorAcoes({ id }: { id: string }) {
  const estado = useCorretorAprovado()
  if (estado !== "aprovado") return null
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-[var(--brand)] p-3">
      <span className="text-xs font-bold tracking-wide text-[var(--brand)] uppercase">
        Área do corretor
      </span>
      <Link
        href={`/corretores/anunciar/${id}`}
        className="rounded-lg border border-slate-300 py-2.5 text-center text-sm font-bold"
      >
        Gerar anúncio para redes sociais
      </Link>
      <AdCartToggle
        id={id}
        className="rounded-lg border border-slate-300 py-2.5 text-center text-sm font-bold"
      />
    </div>
  )
}

/** Envolve páginas que são só da área do corretor. */
export function SoCorretor({ children }: { children: React.ReactNode }) {
  const estado = useCorretorAprovado()
  if (estado === "carregando")
    return <p className="p-8 text-center text-slate-600">Carregando...</p>
  if (estado === "aprovado") return <>{children}</>
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-slate-200 p-8 text-center">
      <h2 className="text-2xl font-extrabold">Ferramenta da área do corretor</h2>
      <p className="text-slate-600">
        {estado === "pendente"
          ? "Seu cadastro está em análise. Assim que o Selo Verde for aprovado, esta ferramenta é liberada."
          : "Anúncios nos portais e nas redes sociais são exclusivos de corretores, imobiliárias e investidores cadastrados."}
      </p>
      <div className="flex justify-center gap-2">
        <Link
          href="/corretores/entrar"
          className="rounded-xl border border-slate-300 px-5 py-3 font-bold"
        >
          Entrar
        </Link>
        <Link
          href="/corretores/cadastro"
          className="rounded-xl bg-[var(--brand)] px-5 py-3 font-bold text-white"
        >
          Cadastrar grátis
        </Link>
      </div>
    </div>
  )
}
