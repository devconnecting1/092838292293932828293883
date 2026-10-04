/**
 * Calculadora de viabilidade de arremate (lógica pura, sem tela).
 *
 * Regras e padrões tirados da calculadora "Arremate na Caixa" do Fabrício:
 * - comissão do leiloeiro de 5% sobre o lance nos leilões (não há na venda direta);
 * - ITBI de 3%, sobre o lance ou sobre a avaliação;
 * - registro e escritura: 3% da avaliação (normal) ou 6% (completo);
 * - assessoria: 5% da avaliação;
 * - dívidas de condomínio na Caixa: o comprador paga até 10% do VALOR DE AVALIAÇÃO
 *   (não do lance/arremate); o que passar disso fica com a Caixa. Nos leilões
 *   judiciais e extrajudiciais de outras origens vale o que estiver no edital;
 * - corretagem na revenda: 6% do valor de venda;
 * - imposto sobre o lucro: 15%;
 * - semáforo do retorno: abaixo de 15% vermelho, até 25% amarelo, acima verde.
 * Todos os percentuais são editáveis na tela. O cenário financiado (SAC) foi
 * acrescentado para comparar lado a lado com o à vista.
 */

export type Modalidade = "1l" | "2l" | "licitacao" | "vdo" | "vo" | "judicial" | "extrajudicial"

export const MODALIDADES: { value: Modalidade; label: string; leilao: boolean }[] = [
  { value: "1l", label: "1º leilão", leilao: true },
  { value: "2l", label: "2º leilão", leilao: true },
  { value: "licitacao", label: "Licitação aberta", leilao: true },
  { value: "vdo", label: "Venda direta online", leilao: false },
  { value: "vo", label: "Venda online", leilao: false },
  { value: "judicial", label: "Leilão judicial", leilao: true },
  { value: "extrajudicial", label: "Leilão extrajudicial", leilao: true },
]

export type Entradas = {
  modalidade: Modalidade
  avaliacao: number
  valorVenda: number
  lance: number
  pLeiloeiro: number
  pITBI: number
  baseITBI: "lance" | "avaliacao"
  escrituraCompleta: boolean
  cartorio: number
  assessoria: number
  temDividas: boolean
  condominio: number
  iptu: number
  limpeza: number
  obra: number
  outros: number
  pCorretagem: number
  pImposto: number
  // Financiamento
  pEntrada: number
  fgts: number
  prazoMeses: number
  taxaAnual: number
  mesesAteVenda: number
}

export type Linha = { item: string; base: string; valor: number }

export type Cenario = {
  nome: string
  desembolsoInicial: number
  parcelasPagas: number
  saldoQuitado: number
  custosExtras: number
  custoTotal: number
  lucroBruto: number
  imposto: number
  lucroLiquido: number
  roi: number
  status: "vermelho" | "amarelo" | "verde"
  primeiraParcela: number
  linhas: Linha[]
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function modalidadeDe(texto: string | null | undefined, origem?: string): Modalidade {
  const t = (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  if (/venda direta/.test(t)) return "vdo"
  if (/venda online/.test(t)) return "vo"
  if (/licitacao/.test(t)) return "licitacao"
  if (/2.?\s*leilao|segundo/.test(t)) return "2l"
  if (/1.?\s*leilao|primeiro/.test(t)) return "1l"
  if (origem === "judicial" || /judicial/.test(t))
    return t.includes("extra") ? "extrajudicial" : "judicial"
  if (origem === "extrajudicial") return "extrajudicial"
  return "vdo"
}

/** Valores sugeridos a partir do imóvel; o corretor ajusta o que souber. */
export function entradasPadrao(p: {
  avaliacao: number | null
  preco: number
  modalidade: Modalidade
}): Entradas {
  const aval = p.avaliacao ?? 0
  return {
    modalidade: p.modalidade,
    avaliacao: aval,
    valorVenda: aval,
    lance: p.preco,
    pLeiloeiro: 5,
    pITBI: 3,
    baseITBI: "lance",
    escrituraCompleta: false,
    cartorio: round2(aval * 0.03),
    assessoria: round2(aval * 0.05),
    temDividas: false,
    condominio: 0,
    iptu: 0,
    limpeza: 0,
    obra: 0,
    outros: 0,
    pCorretagem: 6,
    pImposto: 15,
    pEntrada: 20,
    fgts: 0,
    prazoMeses: 420,
    taxaAnual: 12,
    mesesAteVenda: 12,
  }
}

/** Recalcula os campos automáticos quando muda avaliação, escritura ou dívidas. */
export function ajustarAutomaticos(e: Entradas, mudou: keyof Entradas): Entradas {
  const n = { ...e }
  if (mudou === "avaliacao" || mudou === "escrituraCompleta") {
    n.cartorio = round2(n.avaliacao * (n.escrituraCompleta ? 0.06 : 0.03))
  }
  if (mudou === "avaliacao") n.assessoria = round2(n.avaliacao * 0.05)
  if (mudou === "temDividas" || (mudou === "avaliacao" && n.temDividas)) {
    n.condominio = n.temDividas ? round2(n.avaliacao * 0.1) : 0
    if (!n.temDividas) n.iptu = 0
  }
  return n
}

function status(roi: number): Cenario["status"] {
  if (roi < 15) return "vermelho"
  if (roi < 25) return "amarelo"
  return "verde"
}

export function calcular(e: Entradas): { avista: Cenario; financiado: Cenario } {
  const leilao = MODALIDADES.find((m) => m.value === e.modalidade)?.leilao ?? false
  const cLeiloeiro = leilao ? (e.lance * e.pLeiloeiro) / 100 : 0
  const cITBI = ((e.baseITBI === "lance" ? e.lance : e.avaliacao) * e.pITBI) / 100
  const cCorretagem = (e.valorVenda * e.pCorretagem) / 100
  const regraCaixa = e.modalidade !== "judicial" && e.modalidade !== "extrajudicial"
  const tetoCondominio = round2(e.avaliacao * 0.1)
  const condominio = regraCaixa ? Math.min(e.condominio, tetoCondominio) : e.condominio
  const custosExtras =
    cLeiloeiro +
    cITBI +
    e.cartorio +
    e.assessoria +
    condominio +
    e.iptu +
    e.limpeza +
    e.obra +
    e.outros +
    cCorretagem

  const linhasComuns: Linha[] = [
    {
      item: "Comissão do leiloeiro",
      base: leilao ? `${e.pLeiloeiro}% do lance` : "Não há na venda direta",
      valor: cLeiloeiro,
    },
    {
      item: "ITBI",
      base: `${e.pITBI}% sobre ${e.baseITBI === "lance" ? "o lance" : "a avaliação"}`,
      valor: cITBI,
    },
    {
      item: "Registro e escritura",
      base: e.escrituraCompleta ? "Completo" : "Normal",
      valor: e.cartorio,
    },
    { item: "Assessoria", base: "Técnica e documental", valor: e.assessoria },
    {
      item: "Dívidas (condomínio e IPTU)",
      base: regraCaixa
        ? "Condomínio até 10% da avaliação; o que passar fica com a Caixa"
        : "Conforme o edital",
      valor: condominio + e.iptu,
    },
    { item: "Chaveiro, limpeza e obra", base: "Manutenção", valor: e.limpeza + e.obra },
    { item: "Corretagem na revenda", base: `${e.pCorretagem}% da venda`, valor: cCorretagem },
    { item: "Outros", base: "Diversos", valor: e.outros },
  ]

  // À vista
  const custoAV = e.lance + custosExtras
  const brutoAV = e.valorVenda - custoAV
  const impAV = brutoAV > 0 ? (brutoAV * e.pImposto) / 100 : 0
  const liqAV = brutoAV - impAV
  const roiAV = custoAV > 0 ? (liqAV / custoAV) * 100 : 0
  const avista: Cenario = {
    nome: "À vista",
    desembolsoInicial: e.lance + custosExtras,
    parcelasPagas: 0,
    saldoQuitado: 0,
    custosExtras,
    custoTotal: custoAV,
    lucroBruto: brutoAV,
    imposto: impAV,
    lucroLiquido: liqAV,
    roi: roiAV,
    status: status(roiAV),
    primeiraParcela: 0,
    linhas: [
      { item: "Lance ou proposta", base: "Pagamento à vista", valor: e.lance },
      ...linhasComuns,
    ],
  }

  // Financiado (SAC): entrada + parcelas até a venda + quitação do saldo na venda.
  const entrada = Math.max(0, (e.lance * e.pEntrada) / 100)
  const financiado = Math.max(0, e.lance - entrada - e.fgts)
  const i = Math.pow(1 + e.taxaAnual / 100, 1 / 12) - 1
  const n = Math.max(1, Math.round(e.prazoMeses))
  const amort = financiado / n
  const meses = Math.min(n, Math.max(0, Math.round(e.mesesAteVenda)))
  let saldo = financiado
  let parcelas = 0
  let primeira = 0
  for (let k = 0; k < meses; k++) {
    const p = amort + saldo * i
    if (k === 0) primeira = p
    parcelas += p
    saldo -= amort
  }
  if (meses === 0) primeira = amort + financiado * i
  const capital = entrada + e.fgts + parcelas + custosExtras
  const custoFin = entrada + e.fgts + parcelas + saldo + custosExtras
  const brutoFin = e.valorVenda - custoFin
  const impFin = brutoFin > 0 ? (brutoFin * e.pImposto) / 100 : 0
  const liqFin = brutoFin - impFin
  const roiFin = capital > 0 ? (liqFin / capital) * 100 : 0
  const fin: Cenario = {
    nome: "Financiado",
    desembolsoInicial: entrada + custosExtras,
    parcelasPagas: parcelas,
    saldoQuitado: saldo,
    custosExtras,
    custoTotal: custoFin,
    lucroBruto: brutoFin,
    imposto: impFin,
    lucroLiquido: liqFin,
    roi: roiFin,
    status: status(roiFin),
    primeiraParcela: primeira,
    linhas: [
      { item: "Entrada", base: `${e.pEntrada}% do lance`, valor: entrada },
      { item: "FGTS", base: "Usado na compra", valor: e.fgts },
      { item: "Parcelas até a venda", base: `${meses} meses, SAC`, valor: parcelas },
      { item: "Quitação do saldo na venda", base: "Saldo devedor", valor: saldo },
      ...linhasComuns,
    ],
  }

  return { avista, financiado: fin }
}

/**
 * Lance máximo à vista que ainda entrega o retorno desejado (ROI líquido),
 * mantendo os demais custos. Busca binária entre zero e o valor de venda.
 */
export function lanceMaximo(e: Entradas, roiAlvo: number): number | null {
  if (e.valorVenda <= 0) return null
  let lo = 0
  let hi = e.valorVenda
  if (calcular({ ...e, lance: 1 }).avista.roi < roiAlvo) return null
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2
    if (calcular({ ...e, lance: mid }).avista.roi >= roiAlvo) lo = mid
    else hi = mid
  }
  return Math.floor(lo / 100) * 100
}
