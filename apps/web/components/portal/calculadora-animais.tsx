"use client"

import * as React from "react"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const num = (v: string) => {
  const n = Number(v.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const CAMPOS: [string, string][] = [
  ["cabecas", "Quantidade de animais"],
  ["lance", "Lance por animal (R$)"],
  ["parcelas", "Número de parcelas (1 = à vista)"],
  ["comissao", "Comissão do leiloeiro (% do total)"],
  ["frete", "Frete até a propriedade (R$)"],
  ["sanidade", "Exames, vacinas e GTA por animal (R$)"],
  ["chegada", "Quarentena e manejo na chegada (R$)"],
  ["mercado", "Preço do animal no mercado da sua região (R$ por cabeça)"],
]

/** Custo real de um lote de animais em leilão, por cabeça e no total, com as parcelas. */
export function CalculadoraAnimais() {
  const [v, setV] = React.useState<Record<string, string>>({
    cabecas: "",
    lance: "",
    parcelas: "1",
    comissao: "",
    frete: "",
    sanidade: "",
    chegada: "",
    mercado: "",
  })
  const n = Math.max(0, Math.round(num(v.cabecas ?? "")))
  const lote = n * num(v.lance ?? "")
  const parcelas = Math.max(1, Math.round(num(v.parcelas ?? "") || 1))
  const comissao = (lote * num(v.comissao ?? "")) / 100
  const extras = num(v.frete ?? "") + n * num(v.sanidade ?? "") + num(v.chegada ?? "")
  const total = lote + comissao + extras
  const porCabeca = n ? total / n : 0
  const mercado = num(v.mercado ?? "")
  const economia = n && mercado ? (mercado - porCabeca) * n : 0

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
              placeholder="0"
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 font-normal"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-[var(--brand-soft)] p-6">
        <span className="text-sm font-bold text-slate-600">Custo total do lote</span>
        <p className="text-4xl font-extrabold tracking-tight">{brl(total)}</p>
        <p className="text-slate-700">
          {n
            ? `${brl(porCabeca)} por animal, já com comissão, frete e sanidade.`
            : "Informe a quantidade de animais."}
        </p>
        {parcelas > 1 && lote ? (
          <p className="rounded-xl bg-white p-3 text-sm">
            Lance em {parcelas} parcelas de <b>{brl(lote / parcelas)}</b>. Comissão, frete e
            sanidade costumam ser pagos à parte, logo no início.
          </p>
        ) : null}
        {economia ? (
          <p
            className={`rounded-xl p-3 font-bold ${economia > 0 ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
          >
            {economia > 0
              ? `${brl(economia)} abaixo do preço da sua região.`
              : `${brl(-economia)} acima do preço da sua região: nesse lance não compensa.`}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-slate-600">
          Conta de apoio com os valores informados. O regulamento do leilão define comissão,
          parcelas, garantias e quem paga exames e GTA.
        </p>
      </div>
    </div>
  )
}
