import {
  ActivityIcon,
  BotIcon,
  Building2Icon,
  CreditCardIcon,
  HistoryIcon,
  LandmarkIcon,
  MegaphoneIcon,
  RadarIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * Menu do Console da Plataforma (área interna da equipe dona do SaaS).
 *
 * Para ligar um módulo novo: crie a página em app/plataforma/<rota>/page.tsx
 * (chamando `requirePlatformAdmin()` no começo) e mude `status` para
 * "available". Enquanto estiver "soon", a rota mostra "Em construção" pelo
 * `PlatformPlaceholderPage` e o menu mostra o selo "Em breve".
 */

export const PLATFORM_HOME_PATH = "/plataforma"
export const PLATFORM_HEALTH_PATH = "/plataforma/saude"

export type PlatformNavItem = {
  title: string
  url: string
  icon: LucideIcon
  /** Uma frase do que o módulo faz (placeholder e cabeçalho). */
  description: string
  status: "available" | "soon"
  /** Rotas extras que também marcam o item como ativo. */
  extraActivePaths?: readonly string[]
}

export const PLATFORM_NAV_ITEMS: readonly PlatformNavItem[] = [
  {
    title: "Saúde do sistema",
    url: PLATFORM_HEALTH_PATH,
    icon: ActivityIcon,
    description:
      "Variáveis, rotinas, segredos, filas e assinaturas: o que está funcionando e o que fazer quando não está.",
    status: "available",
    extraActivePaths: [PLATFORM_HOME_PATH],
  },
  {
    title: "Status público",
    url: "/plataforma/status",
    icon: RadarIcon,
    description:
      "Página de status para os clientes: situação de cada parte, medições automáticas, incidentes e manutenções.",
    status: "available",
  },
  {
    title: "Imobiliárias",
    url: "/plataforma/imobiliarias",
    icon: Building2Icon,
    description: "Todas as imobiliárias da plataforma, com plano, uso e situação.",
    status: "available",
  },
  {
    title: "Assinaturas e receita",
    url: "/plataforma/assinaturas",
    icon: CreditCardIcon,
    description: "Assinaturas, receita recorrente, carência e cancelamentos.",
    status: "available",
  },
  {
    title: "Custos de IA",
    url: "/plataforma/custos-ia",
    icon: BotIcon,
    description: "Consumo e custo de IA por imobiliária e por recurso.",
    status: "available",
  },
  {
    title: "Comunicados",
    url: "/plataforma/comunicados",
    icon: MegaphoneIcon,
    description: "Avisos da plataforma para as imobiliárias.",
    status: "available",
  },
  {
    title: "Imóveis da Caixa",
    url: "/plataforma/caixa",
    icon: LandmarkIcon,
    description: "Envio da lista oficial de imóveis da Caixa.",
    status: "available",
  },
  {
    title: "Equipe",
    url: "/plataforma/equipe",
    icon: UsersIcon,
    description:
      "Quem acessa o console e com qual papel; só o Dono convida, muda o papel e remove.",
    status: "available",
  },
  {
    title: "Registro do console",
    url: "/plataforma/registro",
    icon: HistoryIcon,
    description: "Quem fez o quê no console, quando e por quê.",
    status: "available",
  },
]

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
}

function matches(pathname: string, url: string): boolean {
  const path = normalize(pathname)
  // /plataforma só marca a si mesma (senão todo o console marcaria Saúde).
  return url === PLATFORM_HOME_PATH ? path === url : path === url || path.startsWith(`${url}/`)
}

export function isPlatformNavItemActive(pathname: string, item: PlatformNavItem): boolean {
  return (
    matches(pathname, item.url) ||
    (item.extraActivePaths?.some((url) => matches(pathname, url)) ?? false)
  )
}

export function findPlatformNavItem(pathname: string): PlatformNavItem | null {
  return PLATFORM_NAV_ITEMS.find((item) => isPlatformNavItemActive(pathname, item)) ?? null
}

/** Item do menu pela rota exata (para as páginas "Em construção"). */
export function getPlatformNavItem(url: string): PlatformNavItem {
  const item = PLATFORM_NAV_ITEMS.find((entry) => entry.url === url)

  if (!item) {
    throw new Error(`Rota do console sem item no menu: ${url}`)
  }

  return item
}
