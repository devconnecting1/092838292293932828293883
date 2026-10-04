"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { portalBrowserClient } from "@/lib/portal/browser-client"
import { PLANOS, precoBrl, type PlanoId } from "@/lib/portal/planos"

/** Cards dos planos com troca mensal/anual e botão que abre o pagamento seguro. */
export function TabelaPlanos() {
  const router = useRouter()
  const [ciclo, setCiclo] = React.useState<"mensal" | "anual">("mensal")
  const [enviando, setEnviando] = React.useState<PlanoId | null>(null)
  const [erro, setErro] = React.useState("")

  async function assinar(plano: PlanoId) {
    setErro("")
    const sb = portalBrowserClient()
    const sessao = sb ? (await sb.auth.getSession()).data.session : null
    if (!sessao) {
      router.push(`/corretores/cadastro?plano=${plano}`)
      return
    }
    setEnviando(plano)
    try {
      const r = await fetch("/api/portal/assinatura", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessao.access_token}`,
        },
        body: JSON.stringify({ plano, ciclo }),
      })
      const j = (await r.json()) as { url?: string; erro?: string }
      if (j.url) window.location.href = j.url
      else setErro(j.erro ?? "Não foi possível abrir o pagamento.")
    } catch {
      setErro("Sem conexão agora. Tente de novo.")
    } finally {
      setEnviando(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex self-center rounded-full border border-slate-300 p-1">
        {(["mensal", "anual"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCiclo(c)}
            className={`rounded-full px-5 py-2 text-sm font-bold ${ciclo === c ? "bg-[var(--brand)] text-white" : "text-slate-700"}`}
          >
            {c === "mensal" ? "Mensal" : "Anual (2 meses grátis)"}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {PLANOS.map((p) => (
          <article
            key={p.id}
            className={`relative flex flex-col gap-4 rounded-3xl border p-6 ${p.destaque ? "border-2 border-[var(--brand)] shadow-lg" : "border-slate-200"}`}
          >
            {p.destaque ? (
              <span className="absolute -top-3 left-6 rounded-full bg-[#C2410C] px-3 py-1 text-xs font-extrabold text-white">
                Recomendado
              </span>
            ) : null}
            <div>
              <h3 className="text-2xl font-extrabold">{p.nome}</h3>
              <p className="text-sm text-slate-600">{p.para}</p>
            </div>
            <div>
              <span className="text-4xl font-extrabold tracking-tight">
                {precoBrl(ciclo === "mensal" ? p.mensal : p.anual / 12)}
              </span>
              <span className="text-slate-500"> /mês</span>
              {ciclo === "anual" ? (
                <p className="text-xs text-slate-500">
                  {precoBrl(p.anual)} por ano, à vista no cartão
                </p>
              ) : null}
            </div>
            <ul className="flex flex-1 flex-col gap-2 text-sm">
              {p.recursos.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="font-extrabold text-[var(--brand)]">✓</span>
                  {r}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => assinar(p.id)}
              disabled={enviando !== null}
              className={`h-12 rounded-xl font-bold disabled:opacity-50 ${p.destaque ? "bg-[var(--brand)] text-white" : "border-[1.5px] border-[var(--brand)] text-[var(--brand)]"}`}
            >
              {enviando === p.id ? "Abrindo pagamento..." : `Assinar o ${p.nome}`}
            </button>
          </article>
        ))}
      </div>
      {erro ? <p className="text-center text-sm font-bold text-red-700">{erro}</p> : null}
    </div>
  )
}
