"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"
import { PLANOS } from "@/lib/portal/planos"

/** Plano do usuário no painel, com acesso ao portal de pagamento da Stripe. */
export function PlanoAtual({ plano, ate }: { plano: string | null; ate: string | null }) {
  const [erro, setErro] = React.useState("")
  const ativo = plano && plano !== "gratis" && ate && new Date(ate).getTime() > Date.now()
  const nome = PLANOS.find((p) => p.id === plano)?.nome

  async function gerenciar() {
    setErro("")
    const sb = portalBrowserClient()
    const s = sb ? (await sb.auth.getSession()).data.session : null
    if (!s) return
    const r = await fetch("/api/portal/assinatura/gerenciar", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.access_token}` },
    })
    const j = (await r.json()) as { url?: string; erro?: string }
    if (j.url) window.location.href = j.url
    else setErro(j.erro ?? "Não foi possível abrir agora.")
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-5">
      <div>
        <span className="text-sm text-slate-500">Seu plano</span>
        <p className="text-xl font-extrabold">{ativo ? nome : "Grátis"}</p>
        {ativo ? (
          <span className="text-xs text-slate-500">
            Renova em {new Date(ate as string).toLocaleDateString("pt-BR")}
          </span>
        ) : null}
      </div>
      {ativo ? (
        <button
          type="button"
          onClick={gerenciar}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold"
        >
          Gerenciar assinatura
        </button>
      ) : (
        <Link
          href="/assinar"
          className="rounded-lg bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white"
        >
          Ver planos
        </Link>
      )}
      {erro ? <p className="w-full text-sm font-bold text-red-700">{erro}</p> : null}
    </div>
  )
}
