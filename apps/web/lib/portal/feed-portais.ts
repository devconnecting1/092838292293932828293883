import "server-only"

import type { PropertyType, PropertyUsage } from "@workspace/core/properties/enums"
import {
  buildVrsyncFeed,
  type VrsyncBuildResult,
  type VrsyncListingInput,
} from "@workspace/core/portals/vrsync"

import { PORTAL } from "@/lib/portal/config"
import { brl, type PortalListing } from "@/lib/portal/imoveis"
import { siteUrl } from "@/lib/portal/site-url"

/**
 * Converte os imóveis com anúncio aprovado no XML VRSync dos portais
 * (Grupo OLX: ZAP Imóveis, Viva Real e OLX; Imovelweb e Chaves na Mão aceitam
 * o mesmo formato, conforme a integração de cada um [CONFIRMAR com o portal]).
 *
 * O validador do VRSync recusa anúncio sem CEP, com menos de 5 fotos ou com
 * descrição curta. Esses ficam fora do XML e aparecem em `skipped`, sem
 * derrubar o feed.
 */

const TIPOS: Record<string, [PropertyUsage, PropertyType]> = {
  Apartamento: ["residential", "apartment"],
  Casa: ["residential", "house"],
  Sobrado: ["residential", "house"],
  Terreno: ["residential", "land"],
  Gleba: ["rural", "land"],
  Sala: ["commercial", "commercial_room"],
  Loja: ["commercial", "store"],
  Comercial: ["commercial", "office"],
  Galpão: ["industrial", "warehouse"],
  Prédio: ["commercial", "building"],
  "Imóvel rural": ["rural", "farm"],
}

function cep(v: string | null) {
  const d = (v ?? "").replace(/\D/g, "")
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : ""
}

export function imovelParaVrsync(i: PortalListing): VrsyncListingInput {
  const [usage, type] = TIPOS[i.tipo] ?? ["residential", "other"]
  const titulo = [
    i.tipo,
    i.quartos ? `${i.quartos} quarto${i.quartos > 1 ? "s" : ""}` : null,
    "de leilão em",
    i.bairro ?? i.cidade,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 100)
  const descricao = [
    `${i.tipo} de leilão (${i.origemNome}${i.modalidade ? `, ${i.modalidade}` : ""}) em ${[i.bairro, i.cidade, i.uf].filter(Boolean).join(", ")}.`,
    `Valor mínimo ${brl(i.preco)}${i.valorAvaliacao ? `, avaliação ${brl(i.valorAvaliacao)}` : ""}.`,
    i.descricao ?? "",
    "Condições, dívidas e ocupação conforme o edital e a matrícula. Atendimento com corretor e assessoria do edital à chave.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3000)

  return {
    code: i.numero.slice(0, 50),
    title: titulo,
    description: descricao,
    purpose: "sale",
    usage,
    type,
    prices: { salePrice: Math.round(i.preco) },
    livingArea: i.areaPrivativa ?? i.areaTotal ?? undefined,
    lotArea: i.areaTerreno ?? undefined,
    bedrooms: i.quartos ?? undefined,
    parkingSpaces: i.vagas ?? undefined,
    address: {
      country: "BR",
      state: i.uf,
      city: i.cidade,
      neighborhood: i.bairro ?? "",
      street: i.endereco || undefined,
      postalCode: cep(i.cep),
      latitude: i.latitude ?? undefined,
      longitude: i.longitude ?? undefined,
      display: "neighborhood",
    },
    images: i.fotos.map((url, k) => ({ url, isCover: k === 0 })),
    detailUrl: `${siteUrl()}/leiloes/${i.numero}`,
    publicationType: "STANDARD",
  }
}

export function montarFeed(itens: PortalListing[], email: string): VrsyncBuildResult {
  return buildVrsyncFeed(
    {
      provider: PORTAL.name,
      email,
      contactName: PORTAL.name,
      telephone: PORTAL.whatsapp,
      publishDate: new Date(),
    },
    itens.map(imovelParaVrsync)
  )
}
