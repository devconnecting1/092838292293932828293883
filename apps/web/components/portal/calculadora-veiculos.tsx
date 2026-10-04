"use client"

import * as React from "react"
import Link from "next/link"

/* ----------------------------------------------------------------- tipos */

type Tipo = "carros" | "motos" | "caminhoes"
type Item = { codigo: string | number; nome: string }
type Fipe = {
  Valor: string
  Marca: string
  Modelo: string
  AnoModelo: number
  MesReferencia: string
}

const TIPOS: [Tipo, string][] = [
  ["carros", "Carro"],
  ["motos", "Moto"],
  ["caminhoes", "Caminhão"],
]

const REPAROS: [string, number][] = [
  ["Nenhum", 0],
  ["Pequeno", 3],
  ["Médio", 8],
  ["Grande", 15],
]

/** Limite de isenção do ganho de capital para bem de pequeno valor (IN SRF 599/2005, art. 1º, II). */
const ISENCAO_PEQUENO_VALOR = 35000
const IR_PRIMEIRA_FAIXA = 0.15

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const num = (v: string) => {
  const n = Number(
    String(v)
      .replace(/[R$\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  )
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/* ---------------------------------------------------------------- FIPE */

function useFipe(tipo: Tipo) {
  const [marcas, setMarcas] = React.useState<Item[]>([])
  const [modelos, setModelos] = React.useState<Item[]>([])
  const [anos, setAnos] = React.useState<Item[]>([])
  const [sel, setSel] = React.useState({ marca: "", modelo: "", ano: "" })
  const [fipe, setFipe] = React.useState<Fipe | null>(null)
  const [erro, setErro] = React.useState(false)

  const buscar = React.useCallback(async (q: Record<string, string>) => {
    try {
      const r = await fetch(`/api/portal/fipe?${new URLSearchParams(q)}`)
      if (!r.ok) throw new Error()
      setErro(false)
      return (await r.json()) as unknown
    } catch {
      setErro(true)
      return null
    }
  }, [])

  React.useEffect(() => {
    let vivo = true
    void buscar({ tipo }).then((d) => {
      if (!vivo) return
      setMarcas(Array.isArray(d) ? (d as Item[]) : [])
      setModelos([])
      setAnos([])
      setSel({ marca: "", modelo: "", ano: "" })
      setFipe(null)
    })
    return () => {
      vivo = false
    }
  }, [tipo, buscar])

  async function escolherMarca(marca: string) {
    setSel({ marca, modelo: "", ano: "" })
    setModelos([])
    setAnos([])
    setFipe(null)
    if (!marca) return
    const d = (await buscar({ tipo, marca })) as { modelos?: Item[] } | null
    setModelos(d?.modelos ?? [])
  }
  async function escolherModelo(modelo: string) {
    setSel((s) => ({ ...s, modelo, ano: "" }))
    setAnos([])
    setFipe(null)
    if (!modelo) return
    const d = await buscar({ tipo, marca: sel.marca, modelo })
    setAnos(Array.isArray(d) ? (d as Item[]) : [])
  }
  async function escolherAno(ano: string) {
    setSel((s) => ({ ...s, ano }))
    setFipe(null)
    if (!ano) return
    const d = (await buscar({ tipo, marca: sel.marca, modelo: sel.modelo, ano })) as Fipe | null
    if (d?.Valor) setFipe(d)
  }
  return { marcas, modelos, anos, sel, fipe, erro, escolherMarca, escolherModelo, escolherAno }
}

/* --------------------------------------------------------------- campos */

const caixa =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal text-slate-900"
const rot = "flex flex-col gap-1 text-sm font-bold text-slate-700"

function Campo({
  label,
  valor,
  onChange,
  dica,
  sufixo,
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  dica?: string
  sufixo?: string
}) {
  return (
    <label className={rot}>
      {label}
      <span className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className={caixa}
        />
        {sufixo ? <span className="text-sm font-normal text-slate-500">{sufixo}</span> : null}
      </span>
      {dica ? <span className="text-xs font-normal text-slate-500">{dica}</span> : null}
    </label>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5">
      <legend className="px-1 text-sm font-extrabold tracking-wide text-[var(--brand)] uppercase">
        {titulo}
      </legend>
      {children}
    </fieldset>
  )
}

/* ------------------------------------------------------------ calculadora */

/**
 * Calculadora de leilão de veículos: custo total do arremate, comparação com a FIPE, lance
 * máximo para a meta do cliente e, no modo revenda, lucro líquido com o imposto.
 */
export function CalculadoraVeiculos() {
  const [modo, setModo] = React.useState<"uso" | "revenda">("uso")
  const [tipo, setTipo] = React.useState<Tipo>("carros")
  const f = useFipe(tipo)
  const [v, setV] = React.useState<Record<string, string>>({
    lance: "",
    mercado: "",
    comissao: "5",
    taxaAdm: "",
    diaria: "",
    dias: "",
    remocao: "",
    multas: "",
    ipvaAtrasado: "",
    licenciamento: "",
    transferencia: "",
    vistoria: "",
    placa: "",
    despachante: "",
    ipvaAliquota: "",
    reparosValor: "",
    venda: "",
    custoVenda: "",
    meta: "20",
  })
  const [debitosQuitados, setDebitosQuitados] = React.useState(false)
  const [reparoPct, setReparoPct] = React.useState<number | null>(null)
  const set = (k: string) => (x: string) => setV((s) => ({ ...s, [k]: x }))

  // FIPE preenche o valor de mercado (o usuário pode trocar).
  const fipeValor = f.fipe ? num(f.fipe.Valor) : 0
  React.useEffect(() => {
    if (!fipeValor) return
    const t = setTimeout(
      () =>
        setV((s) => ({ ...s, mercado: String(fipeValor), venda: s.venda || String(fipeValor) })),
      0
    )
    return () => clearTimeout(t)
  }, [fipeValor])

  const mercado = num(v.mercado ?? "")
  const lance = num(v.lance ?? "")
  const pctCom = num(v.comissao ?? "") / 100
  const reparos = reparoPct !== null ? (mercado * reparoPct) / 100 : num(v.reparosValor ?? "")
  const debitos = debitosQuitados
    ? 0
    : num(v.multas ?? "") + num(v.ipvaAtrasado ?? "") + num(v.licenciamento ?? "")
  const ipvaAno = (mercado * num(v.ipvaAliquota ?? "")) / 100

  const fixos =
    num(v.taxaAdm ?? "") +
    num(v.diaria ?? "") * num(v.dias ?? "") +
    num(v.remocao ?? "") +
    debitos +
    num(v.transferencia ?? "") +
    num(v.vistoria ?? "") +
    num(v.placa ?? "") +
    num(v.despachante ?? "") +
    ipvaAno +
    reparos

  const custo = (l: number) => l * (1 + pctCom) + fixos
  const total = custo(lance)
  const comissao = lance * pctCom

  // Revenda: lucro líquido com imposto sobre ganho de capital (pessoa física).
  const venda = num(v.venda ?? "")
  const custoVenda = num(v.custoVenda ?? "")
  const lucroDe = (l: number) => {
    const bruto = venda - custoVenda - custo(l)
    const ir = venda > ISENCAO_PEQUENO_VALOR && bruto > 0 ? bruto * IR_PRIMEIRA_FAIXA : 0
    return { bruto, ir, liquido: bruto - ir }
  }
  const lucro = lucroDe(lance)
  const meta = num(v.meta ?? "") / 100

  // Lance máximo para cumprir a meta do cliente.
  let lanceMax = 0
  if (modo === "uso" && mercado > 0) {
    lanceMax = Math.max(0, (mercado * (1 - meta) - fixos) / (1 + pctCom))
  } else if (modo === "revenda" && venda > 0) {
    let lo = 0
    let hi = venda
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      const c = custo(mid)
      if (lucroDe(mid).liquido >= c * meta) lo = mid
      else hi = mid
    }
    lanceMax = lo
  }

  const economia = mercado - total
  const linhas: [string, number][] = (
    [
      ["Lance", lance],
      [`Comissão do leiloeiro (${(pctCom * 100).toLocaleString("pt-BR")}%)`, comissao],
      ["Taxa administrativa", num(v.taxaAdm ?? "")],
      ["Pátio (diárias)", num(v.diaria ?? "") * num(v.dias ?? "")],
      ["Remoção ou guincho", num(v.remocao ?? "")],
      ["Débitos que ficam com você", debitos],
      ["Transferência no Detran", num(v.transferencia ?? "")],
      ["Vistoria ou laudo", num(v.vistoria ?? "")],
      ["Placa Mercosul", num(v.placa ?? "")],
      ["Despachante", num(v.despachante ?? "")],
      ["IPVA do ano", ipvaAno],
      ["Reparos", reparos],
    ] as [string, number][]
  ).filter(([, x]) => x > 0)

  const resumo = [
    `Simulação de leilão de ${TIPOS.find(([t]) => t === tipo)?.[1].toLowerCase()} no Vamos Arrematar`,
    f.fipe
      ? `${f.fipe.Marca} ${f.fipe.Modelo} ${f.fipe.AnoModelo}, FIPE ${f.fipe.Valor} (${f.fipe.MesReferencia.trim()})`
      : "",
    `Lance: ${brl(lance)}`,
    `Custo total: ${brl(total)}`,
    mercado
      ? `Valor de mercado: ${brl(mercado)} · ${economia >= 0 ? "economia" : "acima do mercado"} de ${brl(Math.abs(economia))}`
      : "",
    modo === "revenda" && venda ? `Lucro líquido estimado na revenda: ${brl(lucro.liquido)}` : "",
    lanceMax ? `Lance máximo para a meta: ${brl(lanceMax)}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 rounded-full border border-slate-300 bg-white p-1">
            {(
              [
                ["uso", "Para usar"],
                ["revenda", "Para revender"],
              ] as const
            ).map(([m, l]) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={`rounded-full px-4 py-2 text-sm font-bold ${modo === m ? "bg-[var(--brand)] text-white" : "text-slate-700"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-full border border-slate-300 bg-white p-1">
            {TIPOS.map(([t, l]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-full px-4 py-2 text-sm font-bold ${tipo === t ? "bg-slate-900 text-white" : "text-slate-700"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <Grupo titulo="1. O veículo e a Tabela FIPE">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={rot}>
              Marca
              <select
                value={f.sel.marca}
                onChange={(e) => void f.escolherMarca(e.target.value)}
                className={caixa}
              >
                <option value="">{f.marcas.length ? "Escolha" : "Carregando..."}</option>
                {f.marcas.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className={rot}>
              Modelo
              <select
                value={f.sel.modelo}
                disabled={!f.modelos.length}
                onChange={(e) => void f.escolherModelo(e.target.value)}
                className={caixa}
              >
                <option value="">Escolha</option>
                {f.modelos.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className={rot}>
              Ano
              <select
                value={f.sel.ano}
                disabled={!f.anos.length}
                onChange={(e) => void f.escolherAno(e.target.value)}
                className={caixa}
              >
                <option value="">Escolha</option>
                {f.anos.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {f.fipe ? (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              <b>FIPE {f.fipe.Valor}</b> · {f.fipe.Marca} {f.fipe.Modelo} {f.fipe.AnoModelo} ·
              referência {f.fipe.MesReferencia.trim()}
            </p>
          ) : f.erro ? (
            <p className="text-sm text-slate-500">
              Tabela FIPE fora do ar agora. Digite o valor de mercado abaixo.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              label="Valor de mercado (R$)"
              valor={v.mercado ?? ""}
              onChange={set("mercado")}
              dica="Vem da FIPE e você pode ajustar: veículo de leilão costuma valer menos que a tabela."
            />
            <Campo label="Seu lance (R$)" valor={v.lance ?? ""} onChange={set("lance")} />
          </div>
        </Grupo>

        <Grupo titulo="2. Leiloeiro e pátio (veja no edital)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              label="Comissão do leiloeiro"
              sufixo="%"
              valor={v.comissao ?? ""}
              onChange={set("comissao")}
              dica="Em regra, o comprador paga 5% sobre o lance. Em leilão judicial, vale o que o juiz fixar."
            />
            <Campo
              label="Taxa administrativa (R$)"
              valor={v.taxaAdm ?? ""}
              onChange={set("taxaAdm")}
            />
            <Campo label="Diária do pátio (R$)" valor={v.diaria ?? ""} onChange={set("diaria")} />
            <Campo
              label="Dias até retirar"
              valor={v.dias ?? ""}
              onChange={set("dias")}
              sufixo="dias"
            />
            <Campo
              label="Remoção ou guincho (R$)"
              valor={v.remocao ?? ""}
              onChange={set("remocao")}
            />
          </div>
        </Grupo>

        <Grupo titulo="3. Débitos do veículo">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={debitosQuitados}
              onChange={(e) => setDebitosQuitados(e.target.checked)}
              className="mt-1"
            />
            <span>
              O edital diz que os débitos anteriores ao leilão <b>não</b> ficam com o comprador.
            </span>
          </label>
          {!debitosQuitados ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Multas (R$)" valor={v.multas ?? ""} onChange={set("multas")} />
              <Campo
                label="IPVA atrasado (R$)"
                valor={v.ipvaAtrasado ?? ""}
                onChange={set("ipvaAtrasado")}
              />
              <Campo
                label="Licenciamento e outros (R$)"
                valor={v.licenciamento ?? ""}
                onChange={set("licenciamento")}
              />
            </div>
          ) : null}
        </Grupo>

        <Grupo titulo="4. Documentação e reparos">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              label="Transferência no Detran (R$)"
              valor={v.transferencia ?? ""}
              onChange={set("transferencia")}
            />
            <Campo
              label="Vistoria ou laudo (R$)"
              valor={v.vistoria ?? ""}
              onChange={set("vistoria")}
            />
            <Campo
              label="Placa Mercosul (R$)"
              valor={v.placa ?? ""}
              onChange={set("placa")}
              dica="Só se o veículo ainda tem placa antiga ou está sem placa."
            />
            <Campo
              label="Despachante (R$)"
              valor={v.despachante ?? ""}
              onChange={set("despachante")}
            />
            <Campo
              label="IPVA do ano: alíquota do seu estado"
              sufixo="%"
              valor={v.ipvaAliquota ?? ""}
              onChange={set("ipvaAliquota")}
              dica="Consulte a Secretaria de Fazenda do seu estado. Deixe 0 se já está pago."
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-slate-700">Reparos</span>
            <div className="flex flex-wrap gap-2">
              {REPAROS.map(([l, p]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setReparoPct(p)}
                  className={`rounded-full px-4 py-1.5 text-sm font-bold ${reparoPct === p ? "bg-slate-900 text-white" : "border border-slate-300"}`}
                >
                  {l}
                  {p ? ` (${p}% do valor)` : ""}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setReparoPct(null)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${reparoPct === null ? "bg-slate-900 text-white" : "border border-slate-300"}`}
              >
                Digitar valor
              </button>
            </div>
            {reparoPct === null ? (
              <Campo
                label="Valor dos reparos (R$)"
                valor={v.reparosValor ?? ""}
                onChange={set("reparosValor")}
              />
            ) : (
              <span className="text-xs text-slate-500">
                Percentual de partida sobre o valor de mercado. Depois da vistoria, troque pelo
                orçamento real.
              </span>
            )}
          </div>
        </Grupo>

        {modo === "revenda" ? (
          <Grupo titulo="5. Revenda">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                label="Preço de venda esperado (R$)"
                valor={v.venda ?? ""}
                onChange={set("venda")}
              />
              <Campo
                label="Custos da venda (R$)"
                valor={v.custoVenda ?? ""}
                onChange={set("custoVenda")}
                dica="Anúncios, comissão de quem vender, limpeza."
              />
            </div>
          </Grupo>
        ) : null}
      </div>

      <aside className="flex h-fit flex-col gap-4 rounded-2xl bg-[var(--brand-soft)] p-6 lg:sticky lg:top-24 print:static">
        <span className="text-sm font-bold text-slate-600">Custo total do arremate</span>
        <p className="text-4xl font-extrabold tracking-tight">{brl(total)}</p>
        {mercado > 0 && lance > 0 ? (
          <p
            className={`rounded-xl p-3 font-bold ${economia > 0 ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
          >
            {economia > 0
              ? `${brl(economia)} abaixo do mercado (${((economia / mercado) * 100).toFixed(0)}%)`
              : `${brl(-economia)} acima do mercado: nesse lance não compensa`}
          </p>
        ) : null}

        {modo === "revenda" && venda > 0 && lance > 0 ? (
          <div className="rounded-xl bg-white p-4 text-sm">
            <p className="flex justify-between">
              <span>Lucro antes do imposto</span>
              <b>{brl(lucro.bruto)}</b>
            </p>
            <p className="flex justify-between">
              <span>Imposto sobre o lucro</span>
              <b>{lucro.ir ? brl(lucro.ir) : "isento"}</b>
            </p>
            <p className="mt-1 flex justify-between border-t border-slate-100 pt-1 text-base">
              <span>Lucro líquido</span>
              <b className={lucro.liquido >= 0 ? "text-emerald-700" : "text-red-700"}>
                {brl(lucro.liquido)}
              </b>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Pessoa física: venda de até {brl(ISENCAO_PEQUENO_VALOR)} no mês é isenta; acima disso,
              a conta usa 15% sobre o lucro. Confirme com o seu contador.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 rounded-xl bg-white p-4">
          <Campo
            label={
              modo === "uso"
                ? "Quero pagar abaixo do mercado pelo menos"
                : "Quero lucrar pelo menos"
            }
            sufixo="%"
            valor={v.meta ?? ""}
            onChange={set("meta")}
          />
          <p className="text-sm">
            Lance máximo:{" "}
            <b className="text-lg">{lanceMax ? brl(lanceMax) : "preencha os valores"}</b>
          </p>
          {lanceMax && lance > lanceMax ? (
            <p className="text-sm font-bold text-red-700">Seu lance passa do limite da sua meta.</p>
          ) : null}
        </div>

        {linhas.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {linhas.map(([l, x]) => (
              <li key={l} className="flex flex-col gap-0.5">
                <span className="flex justify-between">
                  <span>{l}</span>
                  <b>{brl(x)}</b>
                </span>
                <span className="h-1.5 rounded-full bg-white">
                  <span
                    className="block h-1.5 rounded-full bg-[var(--brand)]"
                    style={{ width: `${Math.min(100, (x / Math.max(total, 1)) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2 print:hidden">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(resumo)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-[#25D366] px-4 py-2 text-sm font-bold text-white"
          >
            Enviar no WhatsApp
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold"
          >
            Salvar em PDF
          </button>
          <Link
            href="/leilao-de-veiculos#assessoria"
            className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white"
          >
            Quero assessoria
          </Link>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          Conta de apoio com os valores informados por você. Confira cada item no edital antes do
          lance: comissão, taxas, débitos, prazo de retirada e condição do documento.
        </p>
      </aside>
    </div>
  )
}
