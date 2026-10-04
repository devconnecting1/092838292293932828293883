"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

/**
 * Mostra as ferramentas internas só para assinantes, parceiros ativos e equipe.
 * O servidor também confere o plano em cada consulta; aqui é só a tela.
 */
export function FerramentaRestrita({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = React.useState<"carregando" | "fora" | "gratis" | "liberado">(
    "carregando"
  )
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) {
      const t = setTimeout(() => setEstado("fora"), 0)
      return () => clearTimeout(t)
    }
    void (async () => {
      const { data: u } = await sb.auth.getUser()
      if (!u.user) return setEstado("fora")
      const { data, error } = await sb.rpc("plano_ativo", { p_user: u.user.id })
      if (error) {
        const { data: p } = await sb
          .from("perfis")
          .select("perfil")
          .eq("user_id", u.user.id)
          .maybeSingle()
        return setEstado(
          (p as { perfil?: string } | null)?.perfil === "admin" ? "liberado" : "gratis"
        )
      }
      setEstado(data && data !== "gratis" ? "liberado" : "gratis")
    })()
  }, [])

  if (estado === "carregando") return <p className="text-slate-600">Carregando...</p>
  if (estado === "liberado") return <>{children}</>
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6">
      <h2 className="text-xl font-extrabold">Ferramentas internas de análise</h2>
      <p className="leading-relaxed text-slate-700">
        Consulta processual, busca por CPF/CNPJ e leitor de certidões são exclusivos para assinantes
        e corretores parceiros ativos. Quer que a nossa equipe faça a análise do seu imóvel? Peça a
        diligência.
      </p>
      <div className="flex flex-wrap gap-2">
        {estado === "fora" ? (
          <Link
            href="/corretores/entrar?volta=/processos"
            className="rounded-lg bg-[var(--brand)] px-5 py-2.5 font-bold text-white"
          >
            Entrar
          </Link>
        ) : (
          <Link
            href="/assinar"
            className="rounded-lg bg-[var(--brand)] px-5 py-2.5 font-bold text-white"
          >
            Ver planos
          </Link>
        )}
        <Link
          href="/como-funciona/caixa#assessoria"
          className="rounded-lg border border-slate-300 px-5 py-2.5 font-bold"
        >
          Pedir diligência à equipe
        </Link>
      </div>
    </div>
  )
}
