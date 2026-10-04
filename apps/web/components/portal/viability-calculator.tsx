"use client"

import * as React from "react"

import {
  ajustarAutomaticos,
  calcular,
  lanceMaximo,
  MODALIDADES,
  type Cenario,
  type Entradas,
} from "@/lib/portal/viabilidade"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })

const COR: Record<Cenario["status"], string> = {
  vermelho: "bg-red-600",
  amarelo: "bg-amber-500",
  verde: "bg-emerald-600",
}

type Corretor = {
  nome: string
  creci: string
  telefone: string
  cliente: string
  parceria: boolean
}

function Money({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const txt = value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
      {label}
      <input
        inputMode="numeric"
        value={txt}
        onChange={(ev) => {
          const d = ev.target.value.replace(/\D/g, "")
          onChange(d ? Number(d) / 100 : 0)
        }}
        className="h-11 rounded-lg border border-slate-300 px-3 text-right font-bold text-slate-900 print:border-0"
      />
    </label>
  )
}

function Pct({
  label,
  value,
  onChange,
  step = 0.5,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
      {label}
      <input
        type="number"
        step={step}
        min={0}
        value={value}
        onChange={(ev) => onChange(Number(ev.target.value) || 0)}
        className="h-11 rounded-lg border border-slate-300 px-3 text-right font-bold text-slate-900 print:border-0"
      />
    </label>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-extrabold tracking-wide text-[var(--brand)] uppercase">
        {titulo}
      </legend>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </fieldset>
  )
}

function Resultado({ c }: { c: Cenario }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold">{c.nome}</h3>
        <span
          className={`rounded-full px-3 py-1 text-sm font-extrabold text-white ${COR[c.status]}`}
        >
          Retorno {c.roi.toFixed(1)}%
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-slate-600">Desembolso</dt>
        <dd className="text-right font-extrabold">{brl(c.desembolsoInicial)}</dd>
        {c.primeiraParcela ? (
          <>
            <dt className="text-slate-600">1ª parcela (SAC)</dt>
            <dd className="text-right font-bold">{brl(c.primeiraParcela)}</dd>
          </>
        ) : null}
        <dt className="text-slate-600">Lucro antes do imposto</dt>
        <dd className="text-right font-bold">{brl(c.lucroBruto)}</dd>
        <dt className="text-slate-600">Imposto estimado</dt>
        <dd className="text-right font-bold">{brl(c.imposto)}</dd>
        <dt className="text-slate-600">Lucro líquido</dt>
        <dd
          className={`text-right font-extrabold ${c.lucroLiquido < 0 ? "text-red-600" : "text-emerald-700"}`}
        >
          {brl(c.lucroLiquido)}
        </dd>
      </dl>
      <table className="w-full text-xs">
        <tbody>
          {c.linhas
            .filter((l) => l.valor > 0)
            .map((l) => (
              <tr key={l.item} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 font-semibold">{l.item}</td>
                <td className="py-1.5 pr-2 text-slate-500">{l.base}</td>
                <td className="py-1.5 text-right font-bold">{brl(l.valor)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

export function ViabilityCalculator({ inicial, empresa }: { inicial: Entradas; empresa: string }) {
  const [e, setE] = React.useState<Entradas>(inicial)
  const [corretor, setCorretor] = React.useState<Corretor>({
    nome: "",
    creci: "",
    telefone: "",
    cliente: "",
    parceria: false,
  })
  const set = <K extends keyof Entradas>(k: K, v: Entradas[K]) =>
    setE((old) => ajustarAutomaticos({ ...old, [k]: v }, k))
  const r = React.useMemo(() => calcular(e), [e])
  const [alvo, setAlvo] = React.useState(25)
  const teto = React.useMemo(() => lanceMaximo(e, alvo), [e, alvo])

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Bloco titulo="Corretor e cliente">
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700 sm:col-span-1">
              Corretor responsável
              <input
                value={corretor.nome}
                onChange={(ev) => setCorretor({ ...corretor, nome: ev.target.value })}
                className="h-11 rounded-lg border border-slate-300 px-3"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700 sm:col-span-1">
              CRECI
              <input
                value={corretor.creci}
                onChange={(ev) => setCorretor({ ...corretor, creci: ev.target.value })}
                className="h-11 rounded-lg border border-slate-300 px-3"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700 sm:col-span-1">
              WhatsApp do corretor
              <input
                value={corretor.telefone}
                onChange={(ev) => setCorretor({ ...corretor, telefone: ev.target.value })}
                className="h-11 rounded-lg border border-slate-300 px-3"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700 sm:col-span-1">
              Cliente
              <input
                value={corretor.cliente}
                onChange={(ev) => setCorretor({ ...corretor, cliente: ev.target.value })}
                className="h-11 rounded-lg border border-slate-300 px-3"
              />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm font-semibold text-slate-700 print:hidden">
              <input
                type="checkbox"
                checked={corretor.parceria}
                onChange={(ev) => setCorretor({ ...corretor, parceria: ev.target.checked })}
                className="size-5"
              />
              Negócio em parceria com a {empresa}
            </label>
          </Bloco>

          <Bloco titulo="Imóvel e valores">
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Modalidade
              <select
                value={e.modalidade}
                onChange={(ev) => set("modalidade", ev.target.value as Entradas["modalidade"])}
                className="h-11 rounded-lg border border-slate-300 bg-white px-2"
              >
                {MODALIDADES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <Money
              label="Avaliação (edital)"
              value={e.avaliacao}
              onChange={(v) => set("avaliacao", v)}
            />
            <Money label="Lance ou proposta" value={e.lance} onChange={(v) => set("lance", v)} />
            <Money
              label="Valor estimado de venda"
              value={e.valorVenda}
              onChange={(v) => set("valorVenda", v)}
            />
            <Pct
              label="Comissão do leiloeiro (%)"
              value={e.pLeiloeiro}
              onChange={(v) => set("pLeiloeiro", v)}
            />
          </Bloco>

          <Bloco titulo="Documentação e assessoria">
            <Pct label="ITBI (%)" value={e.pITBI} onChange={(v) => set("pITBI", v)} />
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Base do ITBI
              <select
                value={e.baseITBI}
                onChange={(ev) => set("baseITBI", ev.target.value as Entradas["baseITBI"])}
                className="h-11 rounded-lg border border-slate-300 bg-white px-2"
              >
                <option value="lance">Lance</option>
                <option value="avaliacao">Avaliação</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Registro e escritura
              <select
                value={e.escrituraCompleta ? "sim" : "nao"}
                onChange={(ev) => set("escrituraCompleta", ev.target.value === "sim")}
                className="h-11 rounded-lg border border-slate-300 bg-white px-2"
              >
                <option value="nao">Normal (3% da avaliação)</option>
                <option value="sim">Completo (6% da avaliação)</option>
              </select>
            </label>
            <Money label="Cartório" value={e.cartorio} onChange={(v) => set("cartorio", v)} />
            <Money
              label="Assessoria técnica"
              value={e.assessoria}
              onChange={(v) => set("assessoria", v)}
            />
          </Bloco>

          <Bloco titulo="Dívidas e manutenção">
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Dívidas anteriores?
              <select
                value={e.temDividas ? "sim" : "nao"}
                onChange={(ev) => set("temDividas", ev.target.value === "sim")}
                className="h-11 rounded-lg border border-slate-300 bg-white px-2"
              >
                <option value="nao">Não</option>
                <option value="sim">Sim (estimativa de 10% da avaliação)</option>
              </select>
            </label>
            <Money label="Condomínio" value={e.condominio} onChange={(v) => set("condominio", v)} />
            <Money label="IPTU" value={e.iptu} onChange={(v) => set("iptu", v)} />
            <Money
              label="Chaveiro e limpeza"
              value={e.limpeza}
              onChange={(v) => set("limpeza", v)}
            />
            <Money label="Obra e manutenção" value={e.obra} onChange={(v) => set("obra", v)} />
            <Money label="Outros gastos" value={e.outros} onChange={(v) => set("outros", v)} />
          </Bloco>

          <Bloco titulo="Revenda e financiamento">
            <Pct
              label="Corretagem na venda (%)"
              value={e.pCorretagem}
              onChange={(v) => set("pCorretagem", v)}
            />
            <Pct
              label="Imposto sobre o lucro (%)"
              value={e.pImposto}
              onChange={(v) => set("pImposto", v)}
            />
            <Pct
              label="Entrada (%)"
              value={e.pEntrada}
              onChange={(v) => set("pEntrada", v)}
              step={1}
            />
            <Money label="FGTS" value={e.fgts} onChange={(v) => set("fgts", v)} />
            <Pct
              label="Prazo (meses)"
              value={e.prazoMeses}
              onChange={(v) => set("prazoMeses", v)}
              step={12}
            />
            <Pct
              label="Juros ao ano (%)"
              value={e.taxaAnual}
              onChange={(v) => set("taxaAnual", v)}
              step={0.1}
            />
            <Pct
              label="Meses até vender"
              value={e.mesesAteVenda}
              onChange={(v) => set("mesesAteVenda", v)}
              step={1}
            />
          </Bloco>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-2 rounded-2xl bg-[var(--brand-deep)] p-5 text-white">
            <span className="text-sm font-bold tracking-wide uppercase opacity-80">
              Lance máximo seguro
            </span>
            <span className="text-3xl font-extrabold tracking-tight">
              {teto != null ? brl(teto) : "Não fecha a conta"}
            </span>
            <label className="flex items-center gap-2 text-sm">
              para um retorno líquido de
              <input
                type="number"
                min={0}
                max={300}
                step={1}
                value={alvo}
                onChange={(ev) => setAlvo(Number(ev.target.value) || 0)}
                className="h-9 w-16 rounded-md border-0 bg-white px-2 text-right font-bold text-slate-900"
              />
              %
            </label>
            <span className="text-xs opacity-80">
              Acima desse valor o retorno à vista fica abaixo da meta, com os custos acima.
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Resultado c={r.avista} />
            <Resultado c={r.financiado} />
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Estimativa para apoiar a decisão, não garantia de resultado. Taxa de juros, ITBI, custas
            de cartório e imposto variam por banco, município e situação de quem compra: confirme
            cada valor antes do lance e leia o edital e a matrícula.
          </p>
          <div className="flex flex-wrap gap-3 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-xl bg-[var(--brand)] px-5 py-3 font-bold text-white"
            >
              Gerar dossiê em PDF
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
        <strong>Termo de responsabilidade.</strong>{" "}
        {corretor.nome ? `${corretor.nome}` : "O corretor identificado neste estudo"}
        {corretor.creci ? `, ${corretor.creci}` : ""}
        {corretor.telefone ? `, WhatsApp ${corretor.telefone}` : ""}, é o responsável técnico pela
        intermediação e pelas informações deste estudo.{" "}
        {corretor.parceria
          ? `Este negócio é feito em parceria com a ${empresa}, que responde em conjunto com o corretor, nos termos do contrato de parceria.`
          : `A ${empresa} não participa desta intermediação e não responde por ela.`}
        {corretor.cliente ? ` Estudo preparado para ${corretor.cliente}.` : ""}
      </div>
    </div>
  )
}
