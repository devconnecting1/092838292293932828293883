"use client"

import * as React from "react"
import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

type Aba = "arrematar" | "comprar"

const ABAS: [Aba, string, string][] = [
  ["arrematar", "Arrematar", "/leiloes"],
  ["comprar", "Comprar", "/imoveis-a-venda"],
]

const sel = "h-12 rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
const lab = "flex flex-col gap-1 text-xs font-bold text-slate-600"

/** Busca da página inicial com abas: leilão e compra direta com o dono. */
export function BuscaAbas({ tipos }: { tipos: { value: string; label: string }[] }) {
  const [aba, setAba] = React.useState<Aba>("arrematar")
  const acao = ABAS.find(([a]) => a === aba)?.[2] ?? "/leiloes"
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="flex gap-1 self-start rounded-full bg-white p-1 shadow" role="tablist">
        {ABAS.map(([a, rotulo]) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={aba === a}
            onClick={() => setAba(a)}
            className={`rounded-full px-5 py-2 text-sm font-bold ${aba === a ? "bg-[var(--brand)] text-white" : "text-slate-700"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <form
        key={aba}
        action={acao}
        className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-lg sm:flex-row sm:items-end"
      >
        {aba === "arrematar" ? (
          <label className={`${lab} flex-1`}>
            Cidade, bairro ou código
            <input
              name="q"
              placeholder="Ex.: Nova Iguaçu"
              className="h-12 rounded-lg border border-slate-300 px-3 text-base text-slate-900"
            />
          </label>
        ) : (
          <label className={`${lab} flex-1`}>
            Cidade
            <input
              name="cidade"
              placeholder="Ex.: Nova Iguaçu"
              className="h-12 rounded-lg border border-slate-300 px-3 text-base text-slate-900"
            />
          </label>
        )}
        <label className={`${lab} sm:w-28`}>
          Estado
          <select name="uf" defaultValue="" className={sel}>
            <option value="">Todos</option>
            {BRAZILIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}
              </option>
            ))}
          </select>
        </label>
        {aba === "arrematar" ? (
          <label className={`${lab} sm:w-44`}>
            Tipo
            <select name="tipo" defaultValue="" className={sel}>
              <option value="">Todos</option>
              {tipos.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className={`${lab} sm:w-36`}>
            Quartos
            <select name="quartos" defaultValue="" className={sel}>
              <option value="">Todos</option>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  {q}+
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="h-12 rounded-lg bg-[var(--brand)] px-6 font-bold text-white hover:opacity-90">
          Buscar
        </button>
      </form>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
        <Link href="/quanto-vale-meu-imovel" className="text-[var(--brand-deep)] underline">
          Quanto vale meu imóvel?
        </Link>
        <Link href="/anuncie-gratis" className="text-[var(--brand-deep)] underline">
          Quero vender meu imóvel
        </Link>
      </div>
    </div>
  )
}
