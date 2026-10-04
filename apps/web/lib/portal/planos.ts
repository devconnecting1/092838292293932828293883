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
      "Desconto nos anúncios dos portais",
      "Atendimento prioritário no WhatsApp",
    ],
  },
]

export const RANK: Record<string, number> = { gratis: 0, essencial: 1, profissional: 2, premium: 3 }

export function precoBrl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
