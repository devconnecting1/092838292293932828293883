"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

/**
 * Simulador de financiamento com as regras usadas como referência no
 * financiamento habitacional da Caixa: parcela de até 30% da renda bruta,
 * prazo de até 420 meses, idade + prazo de até 80 anos e 6 meses, tabela SAC
 * ou Price. Os parâmetros são editáveis porque mudam por banco, por linha de
 * crédito e por perfil; o resultado é estimativa e não substitui a análise do
 * banco. Seguros obrigatórios e taxa de administração não entram na conta.
 */

const fmt = (v: number, casas = 2) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
const brl = (v: number) => `R$ ${fmt(v)}`

function MoneyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">
      {label}
      <span className="flex h-12 items-center rounded-xl border border-slate-300 bg-white px-3 focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand-mid)]">
        <span className="mr-2 text-sm font-semibold text-slate-500">R$</span>
        <input
          inputMode="numeric"
          value={fmt(value)}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "")
            onChange(d ? Number(d) / 100 : 0)
          }}
          className="w-full bg-transparent text-right text-base font-extrabold text-slate-900 outline-none"
        />
      </span>
      {hint ? <span className="text-xs font-medium text-slate-500">{hint}</span> : null}
    </label>
  )
}

function NumInput({
  label,
  value,
  onChange,
  suf,
  step = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suf: string
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">
      {label}
      <span className="flex h-12 items-center rounded-xl border border-slate-300 bg-white px-3 focus-within:border-[var(--brand)]">
        <input
          type="number"
          step={step}
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full bg-transparent text-right text-base font-extrabold text-slate-900 outline-none"
        />
        <span className="ml-2 text-sm font-semibold text-slate-500">{suf}</span>
      </span>
    </label>
  )
}

export type SimulacaoInicial = {
  valorImovel?: number
  imovelId?: string
  imovelTitulo?: string
}

export function FinancingSimulator({
  valorImovel = 250000,
  imovelId,
  imovelTitulo,
}: SimulacaoInicial) {
  const [valor, setValor] = React.useState(valorImovel)
  const [renda, setRenda] = React.useState(8000)
  const [entrada, setEntrada] = React.useState(Math.round(valorImovel * 0.2 * 100) / 100)
  const [fgts, setFgts] = React.useState(0)
  const [idade, setIdade] = React.useState(35)
  const [taxa, setTaxa] = React.useState(11.5)
  const [comprometimento, setComprometimento] = React.useState(30)
  const [sistema, setSistema] = React.useState<"SAC" | "PRICE">("SAC")
  const [envio, setEnvio] = React.useState<"" | "enviando" | "ok" | "erro">("")

  const prazoMaxIdade = Math.max(12, Math.floor((80.5 - idade) * 12))
  const [prazoEscolhido, setPrazo] = React.useState(420)
  const prazo = Math.min(prazoEscolhido, 420, prazoMaxIdade)

  const financiado = Math.max(0, valor - entrada - fgts)
  const i = Math.pow(1 + taxa / 100, 1 / 12) - 1
  const parcelaPrice = i > 0 ? (financiado * i) / (1 - Math.pow(1 + i, -prazo)) : financiado / prazo
  const amort = financiado / prazo
  const primeira = sistema === "SAC" ? amort + financiado * i : parcelaPrice
  const ultima = sistema === "SAC" ? amort * (1 + i) : parcelaPrice
  const totalPago =
    sistema === "SAC"
      ? amort * prazo + i * amort * ((prazo * (prazo + 1)) / 2)
      : parcelaPrice * prazo
  const limite = (renda * comprometimento) / 100
  const rendaMinima = primeira / (comprometimento / 100)
  const cabe = financiado === 0 || primeira <= limite
  // Quanto a renda permite financiar (pela primeira parcela, no sistema escolhido).
  const maxFinanciavel =
    sistema === "SAC"
      ? limite / (1 / prazo + i)
      : i > 0
        ? (limite * (1 - Math.pow(1 + i, -prazo))) / i
        : limite * prazo
  const pctEntrada = valor > 0 ? ((entrada + fgts) / valor) * 100 : 0

  const resumo = [
    imovelTitulo ? `Imóvel: ${imovelTitulo}${imovelId ? ` (código ${imovelId})` : ""}` : null,
    `Valor do imóvel: ${brl(valor)}`,
    `Entrada: ${brl(entrada)} | FGTS: ${brl(fgts)} (${fmt(pctEntrada, 1)}% do valor)`,
    `Valor financiado: ${brl(financiado)}`,
    `Renda bruta familiar: ${brl(renda)} | Idade: ${idade} anos`,
    `Sistema ${sistema}, ${prazo} meses, juros de ${fmt(taxa, 2)}% ao ano`,
    `1ª parcela: ${brl(primeira)} | Última: ${brl(ultima)}`,
    `Comprometimento: ${fmt(renda > 0 ? (primeira / renda) * 100 : 0, 1)}% da renda (limite ${comprometimento}%)`,
    cabe
      ? "Situação: cabe na renda informada"
      : `Situação: precisa de renda de ${brl(rendaMinima)} ou de mais entrada`,
  ]
    .filter(Boolean)
    .join("\n")

  async function enviar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return setEnvio("erro")
    setEnvio("enviando")
    const { error } = await sb.from("leads").insert({
      imovel_id: imovelId ?? null,
      nome: String(fd.get("nome") ?? "").trim(),
      telefone: String(fd.get("telefone") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim() || null,
      interesse: "financiamento",
      mensagem: resumo,
      consentimento: fd.get("consentimento") === "on",
      origem: imovelId ? "simulador-imovel" : "simulador-credito",
      status: "novo",
    })
    setEnvio(error ? "erro" : "ok")
  }

  return (
    <div className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-4">
        <div>
          <span className="text-xs font-extrabold tracking-wide text-[var(--brand)] uppercase">
            Simulador de financiamento
          </span>
          <h3 className="text-xl font-extrabold tracking-tight">Veja se cabe no seu bolso</h3>
          <p className="text-sm text-slate-600">A conta é feita na hora, enquanto você digita.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput label="Valor do imóvel" value={valor} onChange={setValor} />
          <MoneyInput label="Renda bruta familiar (mês)" value={renda} onChange={setRenda} />
          <MoneyInput
            label="Entrada"
            value={entrada}
            onChange={setEntrada}
            hint={`${fmt(pctEntrada, 1)}% do valor, somando o FGTS`}
          />
          <MoneyInput label="FGTS" value={fgts} onChange={setFgts} />
          <NumInput label="Idade do mais velho" value={idade} onChange={setIdade} suf="anos" />
          <NumInput label="Prazo" value={prazo} onChange={setPrazo} suf="meses" step={12} />
        </div>
        <details className="rounded-xl bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-bold text-slate-700">
            Ajustar juros, sistema e limite de renda
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <NumInput label="Juros ao ano" value={taxa} onChange={setTaxa} suf="%" step={0.1} />
            <NumInput
              label="Limite da renda"
              value={comprometimento}
              onChange={setComprometimento}
              suf="%"
            />
            <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">
              Sistema
              <select
                value={sistema}
                onChange={(e) => setSistema(e.target.value as "SAC" | "PRICE")}
                className="h-12 rounded-xl border border-slate-300 bg-white px-3 font-bold"
              >
                <option value="SAC">SAC (parcela cai)</option>
                <option value="PRICE">Price (parcela fixa)</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Prazo limitado a 420 meses e a idade mais prazo de até 80 anos e meio
            {prazoMaxIdade < 420 ? ` (no seu caso, até ${prazoMaxIdade} meses)` : ""}.
          </p>
        </details>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--brand-deep)] p-5 text-white">
          <span className="text-sm font-semibold opacity-80">1ª parcela estimada</span>
          <span className="text-4xl font-extrabold tracking-tight">{brl(primeira)}</span>
          <span
            className={`self-start rounded-full px-3 py-1 text-sm font-extrabold ${cabe ? "bg-emerald-400 text-emerald-950" : "bg-amber-300 text-amber-950"}`}
          >
            {cabe ? "Cabe na sua renda" : `Precisa de renda de ${brl(rendaMinima)}`}
          </span>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="opacity-80">Valor financiado</dt>
            <dd className="text-right font-bold">{brl(financiado)}</dd>
            <dt className="opacity-80">Última parcela</dt>
            <dd className="text-right font-bold">{brl(ultima)}</dd>
            <dt className="opacity-80">Total pago ao banco</dt>
            <dd className="text-right font-bold">{brl(totalPago)}</dd>
            <dt className="opacity-80">Sua renda permite financiar</dt>
            <dd className="text-right font-bold">{brl(maxFinanciavel)}</dd>
          </dl>
        </div>

        {envio === "ok" ? (
          <p className="rounded-2xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">
            Simulação enviada. A nossa equipe confere com você a documentação e o melhor banco.
          </p>
        ) : (
          <form action={enviar} className="flex flex-col gap-2">
            <span className="text-sm font-extrabold">
              Enviar esta simulação para a nossa equipe
            </span>
            <input
              name="nome"
              required
              minLength={3}
              placeholder="Seu nome"
              className="h-11 rounded-lg border border-slate-300 px-3"
            />
            <input
              name="telefone"
              required
              inputMode="tel"
              placeholder="WhatsApp com DDD"
              className="h-11 rounded-lg border border-slate-300 px-3"
            />
            <input
              name="email"
              type="email"
              placeholder="E-mail (opcional)"
              className="h-11 rounded-lg border border-slate-300 px-3"
            />
            <label className="block text-xs leading-relaxed text-slate-700">
              <input
                type="checkbox"
                name="consentimento"
                required
                className="mr-2 inline size-4 align-[-3px]"
              />
              Autorizo o contato e o uso dos meus dados para esta análise, conforme a{" "}
              <Link href="/privacidade" className="font-bold underline">
                Política de Privacidade
              </Link>
              .
            </label>
            {envio === "erro" ? (
              <p className="text-sm font-bold text-red-700">
                Não foi possível enviar. Tente de novo.
              </p>
            ) : null}
            <button
              disabled={envio === "enviando"}
              className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
            >
              {envio === "enviando" ? "Enviando..." : "Enviar simulação"}
            </button>
          </form>
        )}
        <p className="text-xs leading-relaxed text-slate-500">
          Estimativa de referência. Seguros obrigatórios, taxa de administração e a aprovação de
          crédito dependem do banco. Confirme no simulador oficial do banco antes de decidir.
        </p>
      </div>
    </div>
  )
}
