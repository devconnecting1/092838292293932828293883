"use client"

import * as React from "react"
import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import { portalBrowserClient } from "@/lib/portal/browser-client"
import { whatsappHref } from "@/lib/portal/config"
import { useConfigPortal } from "@/lib/portal/use-config"

type Estimativa = {
  escopo: string
  amostras: number
  m2_p25: number
  m2_mediana: number
  m2_p75: number
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const campo = "h-12 rounded-lg border border-slate-300 bg-white px-3 text-base"
const rotulo = "flex flex-col gap-1 text-sm font-bold text-slate-700"

const ESCOPO: Record<string, string> = {
  "bairro e tipo": "no mesmo bairro e do mesmo tipo",
  bairro: "no mesmo bairro",
  "cidade e tipo": "na mesma cidade e do mesmo tipo",
  cidade: "na mesma cidade",
  "estado e tipo": "no mesmo estado e do mesmo tipo",
  estado: "no mesmo estado",
}

/** Calculadora de preço de venda e de aluguel a partir das avaliações oficiais da região. */
export function CalculadoraPreco({ modo }: { modo: "venda" | "aluguel" }) {
  const cfg = useConfigPortal().calculadora
  const [dados, setDados] = React.useState({
    uf: "RJ",
    cidade: "",
    bairro: "",
    tipo: "Apartamento",
    area: "",
  })
  const [res, setRes] = React.useState<Estimativa | null | "vazio">(null)
  const [calculando, setCalculando] = React.useState(false)
  const [erro, setErro] = React.useState("")

  async function calcular(e: React.FormEvent) {
    e.preventDefault()
    setErro("")
    const area = Number(dados.area.replace(",", "."))
    if (!dados.cidade.trim()) return setErro("Informe a cidade.")
    if (!(area >= 15 && area <= 3000)) return setErro("Informe a área entre 15 e 3.000 m².")
    const sb = portalBrowserClient()
    if (!sb) return setErro("Calculadora indisponível agora.")
    setCalculando(true)
    const { data, error } = await sb.rpc("estimar_m2", {
      p_uf: dados.uf,
      p_cidade: dados.cidade.trim(),
      p_bairro: dados.bairro.trim() || null,
      p_tipo: dados.tipo,
    })
    setCalculando(false)
    if (error) return setErro("Calculadora indisponível agora. Tente mais tarde.")
    const r = (data as Estimativa[] | null)?.[0]
    setRes(r ? r : "vazio")
  }

  const area = Number(dados.area.replace(",", ".")) || 0
  const venda =
    res && res !== "vazio"
      ? { min: res.m2_p25 * area, med: res.m2_mediana * area, max: res.m2_p75 * area }
      : null
  const aluguel = venda
    ? {
        min: (venda.min * cfg.aluguel_min_pct) / 100,
        max: (venda.max * cfg.aluguel_max_pct) / 100,
      }
    : null

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form
        onSubmit={calcular}
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
          <label className={rotulo}>
            Estado
            <select
              value={dados.uf}
              onChange={(e) => setDados({ ...dados, uf: e.target.value })}
              className={campo}
            >
              {BRAZILIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}
                </option>
              ))}
            </select>
          </label>
          <label className={rotulo}>
            Cidade
            <input
              value={dados.cidade}
              onChange={(e) => setDados({ ...dados, cidade: e.target.value })}
              placeholder="Ex.: Nova Iguaçu"
              className={campo}
            />
          </label>
        </div>
        <label className={rotulo}>
          Bairro (opcional, deixa a conta mais precisa)
          <input
            value={dados.bairro}
            onChange={(e) => setDados({ ...dados, bairro: e.target.value })}
            placeholder="Ex.: Centro"
            className={campo}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={rotulo}>
            Tipo
            <select
              value={dados.tipo}
              onChange={(e) => setDados({ ...dados, tipo: e.target.value })}
              className={campo}
            >
              {["Apartamento", "Casa", "Terreno", "Sala", "Loja", "Galpão"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className={rotulo}>
            Área (m²)
            <input
              inputMode="decimal"
              value={dados.area}
              onChange={(e) => setDados({ ...dados, area: e.target.value })}
              placeholder="Ex.: 65"
              className={campo}
            />
          </label>
        </div>
        {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
        <button
          disabled={calculando}
          className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-60"
        >
          {calculando
            ? "Calculando..."
            : modo === "venda"
              ? "Calcular o valor de venda"
              : "Calcular o aluguel"}
        </button>
      </form>

      <div className="flex flex-col gap-4 rounded-2xl bg-[var(--brand-soft)] p-6">
        {res === null ? (
          <p className="text-slate-700">
            Preencha os dados ao lado. A conta usa o valor do metro quadrado das avaliações oficiais
            dos imóveis de leilão da região que estão na nossa base hoje.
          </p>
        ) : res === "vazio" ? (
          <>
            <p className="font-extrabold">Ainda não temos avaliações suficientes nessa região.</p>
            <p className="text-slate-700">
              Para não te dar um número sem base, a calculadora só responde com pelo menos{" "}
              {cfg.minimo_amostras} imóveis comparáveis. Peça uma avaliação feita por corretor
              avaliador.
            </p>
          </>
        ) : venda && aluguel ? (
          <>
            {modo === "venda" ? (
              <>
                <span className="text-sm font-bold text-slate-600">Valor de venda estimado</span>
                <p className="text-4xl font-extrabold tracking-tight">{brl(venda.med)}</p>
                <p className="text-slate-700">
                  Faixa provável: {brl(venda.min)} a {brl(venda.max)}.
                </p>
                <p className="text-sm text-slate-600">
                  Para quem compra para investir: renda de aluguel estimada entre {brl(aluguel.min)}{" "}
                  e {brl(aluguel.max)} por mês.
                </p>
              </>
            ) : (
              <>
                <span className="text-sm font-bold text-slate-600">Aluguel mensal estimado</span>
                <p className="text-4xl font-extrabold tracking-tight">
                  {brl(aluguel.min)} a {brl(aluguel.max)}
                </p>
                <p className="text-slate-700">
                  Sobre um valor de imóvel estimado em {brl(venda.med)} (faixa de {brl(venda.min)} a{" "}
                  {brl(venda.max)}).
                </p>
              </>
            )}
            <div className="rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-700">
              <b>De onde vem a conta.</b> Mediana de {brl(res.m2_mediana)} por m² em {res.amostras}{" "}
              avaliações oficiais de imóveis de leilão {ESCOPO[res.escopo] ?? "na região"},
              multiplicada pela área informada. O aluguel considera de{" "}
              {String(cfg.aluguel_min_pct).replace(".", ",")}% a{" "}
              {String(cfg.aluguel_max_pct).replace(".", ",")}% do valor do imóvel por mês. É uma
              estimativa estatística, não é laudo de avaliação: estado de conservação, andar, vista
              e lazer mudam o preço.
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/anuncie-gratis"
                className="rounded-full bg-[var(--brand)] px-5 py-2.5 font-bold text-white"
              >
                Anunciar para vender
              </Link>
              <a
                href={whatsappHref(
                  "Olá! Fiz a estimativa no site e quero uma avaliação do meu imóvel feita por corretor avaliador."
                )}
                className="rounded-full border border-slate-300 bg-white px-5 py-2.5 font-bold"
              >
                Pedir avaliação profissional
              </a>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
