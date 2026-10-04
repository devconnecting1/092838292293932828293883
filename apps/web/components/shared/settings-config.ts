import {
  CreditCardIcon,
  FileSpreadsheetIcon,
  GiftIcon,
  HandCoinsIcon,
  GlobeIcon,
  MessageSquareTextIcon,
  PlugIcon,
  PlugZapIcon,
  ShieldCheckIcon,
  ShuffleIcon,
  StoreIcon,
  Trash2Icon,
  TrendingUpIcon,
  UserCogIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react"

import { NAV_GROUPS } from "@/components/crm/nav-config"
import { ORGANIZATION_VIEWER_ROLES, TEAM_MANAGER_ROLES, type Role } from "@/lib/auth/roles"
import { REFERRALS_SETTINGS_PATH, SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"
import { TEAMS_SETTINGS_PATH } from "@/lib/equipes/constants"
import { IMPORT_ROLES, IMPORT_SETTINGS_PATH } from "@/lib/importacao/constants"
import { INTEGRATIONS_SETTINGS_PATH } from "@/lib/integracoes/constants"
import { TRASH_ROLES, TRASH_SETTINGS_PATH } from "@/lib/lixeira/constants"
import { FORECAST_SETTINGS_PATH } from "@/lib/previsao/constants"
import { WHATSAPP_TEMPLATES_SETTINGS_PATH } from "@/lib/whatsapp-templates/constants"

/** Índice de configurações (estilo Stripe). */
export const SETTINGS_INDEX_PATH = "/configuracoes"

export const ORGANIZATION_SETTINGS_PATH = "/configuracoes/imobiliaria"
export const TEAM_SETTINGS_PATH = "/configuracoes/equipe"
/** Entrada de leads dos portais e dos anúncios (definida em lib/integracoes). */
export { INTEGRATIONS_SETTINGS_PATH }
/** Contas da própria imobiliária em serviços de terceiros (WhatsApp oficial). */
export const CONNECTIONS_SETTINGS_PATH = "/configuracoes/conexoes"
/** Rodízio (roleta) de leads, escala de plantão e prazo de primeiro contato. */
export const LEAD_ROUTING_SETTINGS_PATH = "/configuracoes/rodizio"
/** Referência de papéis: aberta a todos os membros (a Equipe é só da gestão). */
export const ROLE_PERMISSIONS_SETTINGS_PATH = "/configuracoes/permissoes"
/** Tabela de comissão, divisão entre os papéis e limite de desconto. */
export const COMMISSIONS_SETTINGS_PATH = "/configuracoes/comissoes"
/** O perfil ainda não mudou para /configuracoes/perfil (depende do agente de autenticação). */
export const PROFILE_SETTINGS_PATH = "/perfil"

export type SettingsItem = {
  /** Título no índice. */
  title: string
  /** Rótulo curto na sub-navegação; sem valor, o item não aparece nela. */
  navTitle?: string
  description: string
  icon: LucideIcon
  /** Sem `href`: item previsto no plano, mostrado como "Em breve". */
  href?: string
  /** Papéis que veem o item. Sem valor: todos. A página também valida no servidor. */
  roles?: readonly Role[]
}

export type SettingsSection = {
  title: string
  items: SettingsItem[]
}

/**
 * Papéis do item igual ao da sidebar (nav-config), para que índice, sub-navegação e
 * menu lateral nunca divirjam. O fallback só vale se o item sair da sidebar.
 */
function sidebarRoles(url: string, fallback: readonly Role[]) {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.url === url)

    if (item) {
      return item.roles
    }
  }

  return fallback
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    title: "Minha conta",
    items: [
      {
        title: "Meu perfil",
        navTitle: "Meu perfil",
        description: "Nome, foto, telefone, CRECI e senha de acesso.",
        icon: UserRoundIcon,
        href: PROFILE_SETTINGS_PATH,
      },
    ],
  },
  {
    title: "Imobiliária",
    items: [
      {
        title: "Imobiliária",
        navTitle: "Imobiliária",
        description: "Nome, CNPJ, CRECI, logo e cor usados no CRM e na captação.",
        icon: StoreIcon,
        href: ORGANIZATION_SETTINGS_PATH,
        roles: sidebarRoles(ORGANIZATION_SETTINGS_PATH, ORGANIZATION_VIEWER_ROLES),
      },
      {
        title: "Equipe",
        navTitle: "Equipe",
        description: "Convites, papéis e CRECI de quem tem acesso.",
        icon: UserCogIcon,
        href: TEAM_SETTINGS_PATH,
        roles: sidebarRoles(TEAM_SETTINGS_PATH, TEAM_MANAGER_ROLES),
      },
      {
        title: "Equipes comerciais",
        navTitle: "Equipes",
        description:
          "Equipes com líder para subtotais, metas e previsão por equipe nos relatórios.",
        icon: UsersRoundIcon,
        href: TEAMS_SETTINGS_PATH,
        // Sem `roles`: todo membro vê a própria equipe; só dono e gerente editam.
      },
      {
        title: "Rodízio de leads",
        navTitle: "Rodízio",
        description: "Distribuição automática dos leads, escala de plantão e prazo de resposta.",
        icon: ShuffleIcon,
        href: LEAD_ROUTING_SETTINGS_PATH,
        roles: sidebarRoles(LEAD_ROUTING_SETTINGS_PATH, TEAM_MANAGER_ROLES),
      },
      {
        title: "Mensagens de WhatsApp",
        navTitle: "WhatsApp",
        description: "Modelos de mensagem com nome do cliente, imóvel e link para a equipe usar.",
        icon: MessageSquareTextIcon,
        href: WHATSAPP_TEMPLATES_SETTINGS_PATH,
        // Sem `roles`: toda a equipe vê os modelos; só dono e gerente editam.
      },
      {
        title: "Papéis e permissões",
        navTitle: "Papéis",
        description: "O que cada papel pode fazer no CRM, área por área.",
        icon: ShieldCheckIcon,
        href: ROLE_PERMISSIONS_SETTINGS_PATH,
        // Sem `roles`: qualquer membro precisa saber o que pode fazer.
      },
      {
        title: "Comissões",
        navTitle: "Comissões",
        description:
          "Percentual por tipo de negócio, divisão entre os papéis e limite de desconto.",
        icon: HandCoinsIcon,
        href: COMMISSIONS_SETTINGS_PATH,
        roles: sidebarRoles(COMMISSIONS_SETTINGS_PATH, TEAM_MANAGER_ROLES),
      },
      {
        title: "Previsão de vendas",
        navTitle: "Previsão",
        description:
          "Chance de fechar cada proposta em aberto por etapa, usada no pipeline ponderado.",
        icon: TrendingUpIcon,
        href: FORECAST_SETTINGS_PATH,
        roles: sidebarRoles(FORECAST_SETTINGS_PATH, TEAM_MANAGER_ROLES),
      },
      {
        title: "Assinatura",
        navTitle: "Assinatura",
        description: "Plano, uso, forma de pagamento e faturas.",
        icon: CreditCardIcon,
        href: SUBSCRIPTION_SETTINGS_PATH,
        roles: sidebarRoles(SUBSCRIPTION_SETTINGS_PATH, ORGANIZATION_VIEWER_ROLES),
      },
      {
        title: "Indique e ganhe",
        navTitle: "Indicações",
        description: "Seu link de indicação e o desconto acumulado na mensalidade.",
        icon: GiftIcon,
        href: REFERRALS_SETTINGS_PATH,
        // Mesmos papéis de Assinatura.
        roles: sidebarRoles(SUBSCRIPTION_SETTINGS_PATH, ORGANIZATION_VIEWER_ROLES),
      },
      {
        title: "Portais",
        navTitle: "Portais",
        description: "Feed de anúncios para ZAP Imóveis, Viva Real e OLX.",
        icon: GlobeIcon,
        // A integração por feed já existe na página da imobiliária.
        href: `${ORGANIZATION_SETTINGS_PATH}#portais`,
        roles: sidebarRoles(ORGANIZATION_SETTINGS_PATH, ORGANIZATION_VIEWER_ROLES),
      },
      {
        title: "Integrações",
        navTitle: "Integrações",
        description: "Leads do ZAP, Viva Real, OLX e dos anúncios do Facebook e Instagram.",
        icon: PlugIcon,
        href: INTEGRATIONS_SETTINGS_PATH,
        roles: sidebarRoles(INTEGRATIONS_SETTINGS_PATH, TEAM_MANAGER_ROLES),
      },
      {
        title: "Conexões",
        navTitle: "Conexões",
        description:
          "Contas da própria imobiliária em serviços de terceiros (WhatsApp oficial), com o que cada uma custa direto com o fornecedor.",
        icon: PlugZapIcon,
        href: CONNECTIONS_SETTINGS_PATH,
        roles: sidebarRoles(CONNECTIONS_SETTINGS_PATH, TEAM_MANAGER_ROLES),
      },
      {
        title: "Importar planilhas",
        navTitle: "Importação",
        description:
          "Traga clientes, leads e imóveis do sistema antigo ou do Excel (.csv ou .xlsx) sem digitar.",
        icon: FileSpreadsheetIcon,
        href: IMPORT_SETTINGS_PATH,
        roles: IMPORT_ROLES,
      },
      {
        title: "Lixeira",
        navTitle: "Lixeira",
        description:
          "Leads, clientes e imóveis excluídos: restaure em até 30 dias ou apague de vez, respeitando a guarda legal.",
        icon: Trash2Icon,
        href: TRASH_SETTINGS_PATH,
        roles: TRASH_ROLES,
      },
    ],
  },
]

function canSee(item: SettingsItem, role: Role) {
  return !item.roles || item.roles.includes(role)
}

/** Seções do índice visíveis para o papel (seções vazias somem). */
export function getSettingsSectionsForRole(role: Role) {
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(item, role)),
  })).filter((section) => section.items.length > 0)
}

export type SettingsNavGroup = {
  title: string
  items: { title: string; href: string; icon: LucideIcon }[]
}

/**
 * Sub-navegação vertical: Imobiliária, Equipe, Assinatura, Portais e Meu perfil, na
 * ordem da imobiliária primeiro (é onde o gestor passa mais tempo) e, dentro de cada
 * seção, na mesma ordem do índice.
 */
export function getSettingsNavForRole(role: Role): SettingsNavGroup[] {
  const groups: SettingsNavGroup[] = [...SETTINGS_SECTIONS].reverse().map((section) => ({
    title: section.title,
    items: section.items
      .filter((item) => item.navTitle && item.href && canSee(item, role))
      .map((item) => ({
        title: item.navTitle as string,
        href: item.href as string,
        icon: item.icon,
      })),
  }))

  return groups.filter((group) => group.items.length > 0)
}
