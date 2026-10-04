/** Planos de assinatura do portal (preços em reais). */

export type PlanoId = "essencial" | "profissional" | "premium"

export type Plano = {
  id: PlanoId
  nome: string
  para: string
  mensal: number
  /** Anual = 10 mensalidades (2 meses grátis). */
  anual: number
  destaque?: boolean
  recursos: string[]
}

export const PLANOS: Plano[] = [
  {
    id: "essencial",
    nome: "Essencial",
    para: "Para quem está começando a investir",
    mensal: 39.9,
    anual: 399,
    recursos: [
      "Calculadora de viabilidade completa, com lance máximo",
      "Planilha dos imóveis filtrados",
      "Consulta processual: 10 por mês",
      "Leitor de certidões em PDF: 5 por mês",
      "Simulador de proposta e de financiamento",
      "Pré-análise grátis de processo judicial ativo",
    ],
  },
  {
    id: "profissional",
    nome: "Profissional",
    para: "Para corretor que quer cliente todo dia",
    mensal: 79.9,
    anual: 799,
    destaque: true,
    recursos: [
      "Tudo do Essencial",
      "Leads do rodízio por proximidade (cidade e bairro)",
      "Página própria com foto, logo e CRECI",
      "Kit de anúncio para redes sociais",
      "Relatório de viabilidade com a sua marca",
      "Consulta processual: 50 por mês",
      "Processos por CPF/CNPJ: 20 por mês",
      "Leitor de certidões em PDF: 30 por mês",
      "Vitrine de imóveis avulsos (4% de comissão)",
    ],
  },
  {
    id: "premium",
    nome: "Premium",
    para: "Para imobiliária e investidor de volume",
    mensal: 149.9,
    anual: 1499,
    recursos: [
      "Tudo do Profissional",
      "Prioridade no rodízio de leads",
      "Consulta processual sem limite (uso justo)",
      "Processos por CPF/CNPJ: 200 por mês",
      "Leitor de certidões em PDF: 300 por mês",
      "Desconto nos anúncios dos portais",
      "Atendimento prioritário no WhatsApp",
    ],
  },
]

export const RANK: Record<string, number> = { gratis: 0, essencial: 1, profissional: 2, premium: 3 }

export function precoBrl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

/** Ajustes que o CEO grava em config_portal.planos: {essencial: {mensal, anual, nome, ...}}. */
export type AjustePlanos = Partial<
  Record<
    PlanoId,
    Partial<Pick<Plano, "nome" | "para" | "mensal" | "anual" | "recursos" | "destaque">>
  >
>

/** Junta a tabela padrão com os valores definidos pelo CEO. Valor inválido cai no padrão. */
export function aplicarAjustePlanos(ajuste: unknown): Plano[] {
  const a = (ajuste && typeof ajuste === "object" ? ajuste : {}) as AjustePlanos
  return PLANOS.map((p) => {
    const x = a[p.id] ?? {}
    const n = (v: unknown, padrao: number) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : padrao
    const s = (v: unknown, padrao: string) =>
      typeof v === "string" && v.trim() ? v.trim() : padrao
    const recursos =
      Array.isArray(x.recursos) &&
      x.recursos.every((r) => typeof r === "string") &&
      x.recursos.length
        ? x.recursos.map((r) => r.trim()).filter(Boolean)
        : p.recursos
    return {
      ...p,
      nome: s(x.nome, p.nome),
      para: s(x.para, p.para),
      mensal: n(x.mensal, p.mensal),
      anual: n(x.anual, p.anual),
      destaque: typeof x.destaque === "boolean" ? x.destaque : p.destaque,
      recursos,
    }
  })
}
