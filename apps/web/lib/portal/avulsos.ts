/** Imóveis avulsos (anunciados pelo proprietário, corretor ou investidor). */

export const AUTORIZACAO_VERSAO = "2026-10-v1"

export type Avulso = {
  id: string
  dono_id: string
  origem: "proprietario" | "corretor" | "investidor"
  tipo: string
  titulo: string
  descricao: string
  preco: number
  uf: string
  cidade: string
  bairro: string | null
  endereco: string | null
  quartos: number | null
  vagas: number | null
  area: number | null
  fotos: string[]
  contato_nome: string
  contato_telefone: string
  aceita_corretor: boolean
  comissao_total: number
  comissao_corretor?: number | null
  comissao_plataforma?: number | null
  status: "pendente" | "aprovado" | "recusado" | "vendido" | "pausado"
  motivo: string | null
  criado: string
}

export const ORIGEM_ROTULO: Record<Avulso["origem"], string> = {
  proprietario: "Imóvel avulso",
  corretor: "Imóvel do corretor",
  investidor: "Imóvel do investidor",
}

export const TIPOS_AVULSO = [
  "Apartamento",
  "Casa",
  "Sobrado",
  "Terreno",
  "Sala",
  "Loja",
  "Galpão",
  "Imóvel rural",
]

/** Link do ChatGPT com o pedido de texto já escrito (o proprietário cola o resultado). */
export function linkSugestaoTexto(d: {
  tipo: string
  bairro: string
  cidade: string
  quartos: string
  area: string
}) {
  const pedido = `Escreva um anúncio curto e honesto para vender um(a) ${d.tipo || "imóvel"}${d.quartos ? ` de ${d.quartos} quartos` : ""}${d.area ? `, ${d.area} m²` : ""}, no bairro ${d.bairro || "(bairro)"}, em ${d.cidade || "(cidade)"}. Até 600 caracteres, em português do Brasil, sem exageros e sem inventar características. Deixe espaços entre colchetes para eu completar o que não sei.`
  return `https://chatgpt.com/?q=${encodeURIComponent(pedido)}`
}
