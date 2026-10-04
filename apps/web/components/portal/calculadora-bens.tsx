"use client"

import * as React from "react"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

const CAMPOS: [string, string, string][] = [
  ["lance", "Lance que pretende dar (R$)", "40000"],
  ["comissao", "Comissão do leiloeiro (% do lance, veja no edital)", "5"],
  ["taxas", "Taxas do leilão e do pátio (R$)", "800"],
  ["debitos", "Débitos que ficam com você pelo edital (R$)", "0"],
  ["transporte", "Transporte ou retirada (R$)", "600"],
  ["documentacao", "Documentação e regularização (R$)", "900"],
  ["reparos", "Reparos previstos (R$)", "2000"],
  ["mercado", "Valor de mercado do bem (tabela ou venda de similares, R$)", "60000"],
]

const num = (v: string) => {
  const n = Number(v.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Custo total do arremate de um bem (veículo, máquina, animal) contra o valor de mercado. */
export function CalculadoraBens() {
  const [v, setV] = React.useState<Record<string, string>>(
    Object.fromEntries(CAMPOS.map(([k, , ex]) => [k, ex]))
  )
  const lance = num(v.lance ?? "")
  const comissao = (lance * num(v.comissao ?? "")) / 100
  const total =
    lance +
    comissao +
    ["taxas", "debitos", "transporte", "documentacao", "reparos"].reduce(
      (s, k) => s + num(v[k] ?? ""),
      0
    )
  const mercado = num(v.mercado ?? "")
  const economia = mercado - total
  const pct = mercado > 0 ? (economia / mercado) * 100 : 0

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS.map(([k, l]) => (
          <label key={k} className="flex flex-col gap-1 text-sm font-bold text-slate-700">
            {l}
            <input
              inputMode="decimal"
              value={v[k] ?? ""}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 font-normal"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-[var(--brand-soft)] p-6">
        <span className="text-sm font-bold text-slate-600">Custo total do arremate</span>
        <p className="text-4xl font-extrabold tracking-tight">{brl(total)}</p>
        <p className="text-slate-700">
          Lance {brl(lance)} + comissão do leiloeiro {brl(comissao)} + taxas, débitos, transporte,
          documentação e reparos.
        </p>
        {mercado > 0 ? (
          <p
            className={`rounded-xl p-4 font-bold ${economia > 0 ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
          >
            {economia > 0
              ? `Sai ${brl(economia)} abaixo do mercado (${pct.toFixed(0)}% de economia).`
              : `Sai ${brl(-economia)} acima do mercado. Nesse lance, não compensa.`}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-slate-600">
          Conta de apoio com os valores que você informou. Antes do lance, confira no edital quem
          paga cada débito, a comissão do leiloeiro e o prazo de retirada.
        </p>
      </div>
    </div>
  )
}
