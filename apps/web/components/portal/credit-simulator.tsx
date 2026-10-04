"use client"

import * as React from "react"

const brl = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  })

const FIELDS = [
  { k: "renda", label: "Renda familiar mensal", pre: "R$", suf: "" },
  { k: "entrada", label: "Valor de entrada", pre: "R$", suf: "" },
  { k: "pct", label: "Renda comprometida", pre: "", suf: "%" },
  { k: "taxa", label: "Juros ao ano", pre: "", suf: "%" },
  { k: "prazo", label: "Prazo", pre: "", suf: "meses" },
] as const

type Key = (typeof FIELDS)[number]["k"]

export function CreditSimulator({ ctaHref }: { ctaHref: string }) {
  const [v, setV] = React.useState<Record<Key, string>>({
    renda: "8000",
    entrada: "40000",
    pct: "30",
    taxa: "11",
    prazo: "360",
  })
  const n = (k: Key) => {
    const x = Number(v[k].replace(",", "."))
    return Number.isFinite(x) ? x : 0
  }
  const pmt = (n("renda") * n("pct")) / 100
  const i = Math.pow(1 + n("taxa") / 100, 1 / 12) - 1
  const months = Math.max(1, n("prazo"))
  const fin = i > 0 ? (pmt * (1 - Math.pow(1 + i, -months))) / i : pmt * months

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg">
      <span className="text-lg font-extrabold">Simulação rápida</span>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.k} className="flex flex-col gap-1.5 text-sm font-bold text-slate-600">
            {f.label}
            <span className="flex h-12 items-center rounded-lg border border-slate-300 px-3">
              {f.pre ? <span className="mr-1.5 text-sm text-slate-500">{f.pre}</span> : null}
              <input
                inputMode="decimal"
                value={v[f.k]}
                onChange={(e) => setV({ ...v, [f.k]: e.target.value })}
                className="w-full bg-transparent text-base font-semibold text-slate-900 outline-none"
              />
              {f.suf ? <span className="ml-1.5 text-sm text-slate-500">{f.suf}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-[var(--brand-soft)] p-4">
        <Row l="Parcela máxima estimada" v={brl(pmt)} />
        <Row l="Financiamento possível" v={brl(fin)} />
        <div className="mt-1 flex justify-between gap-3 border-t border-slate-300 pt-2">
          <span className="font-extrabold">Imóvel de até</span>
          <span className="text-2xl font-extrabold text-[var(--brand-deep)]">
            {brl(fin + n("entrada"))}
          </span>
        </div>
      </div>
      <span className="text-xs text-slate-500">
        Estimativa. O limite de renda, a taxa e o prazo são definidos pelo banco na análise.
      </span>
      <a
        href={ctaHref}
        className="rounded-xl bg-[var(--brand)] py-3.5 text-center font-extrabold text-white"
      >
        Pedir análise de crédito
      </a>
    </div>
  )
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-slate-600">{l}</span>
      <span className="font-extrabold">{v}</span>
    </div>
  )
}
