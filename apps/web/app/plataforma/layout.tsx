import type { Metadata } from "next"
import { cookies } from "next/headers"

import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Toaster } from "@workspace/ui/components/toast"

import { APP_NAME } from "@/components/crm/brand"
import type { OrganizationOption } from "@/components/crm/organization-switcher"
import { ConsoleHeader } from "@/components/plataforma/console-header"
import { ConsoleSidebar } from "@/components/plataforma/console-sidebar"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { getMemberships, type Membership } from "@/lib/auth/session"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"
import {
  buildTenantOrigin,
  getTenancyMode,
  isSubdomainTenancy,
  isValidTenantSlug,
} from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: {
    template: `%s · Console da Plataforma · ${APP_NAME}`,
    default: `Console da Plataforma · ${APP_NAME}`,
  },
  robots: { index: false, follow: false },
}

/**
 * Imobiliárias da própria pessoa, para o menu "voltar ao CRM". Falha aqui não
 * derruba o console: o menu só fica sem a lista.
 */
async function loadOwnOrganizations(userId: string): Promise<OrganizationOption[]> {
  let memberships: Membership[]

  try {
    memberships = await getMemberships(userId)
  } catch (error) {
    console.error(
      "[plataforma] falha ao carregar as imobiliárias de quem está no console:",
      error instanceof Error ? error.message : "erro desconhecido"
    )
    return []
  }

  const isSubdomain = isSubdomainTenancy()

  return memberships.map((item) => ({
    id: item.organizationId,
    name: item.organization.name,
    roleLabel: ROLE_LABELS[item.role],
    origin:
      isSubdomain && isValidTenantSlug(item.organization.slug)
        ? buildTenantOrigin(item.organization.slug)
        : null,
  }))
}

/**
 * Console da Plataforma: área interna da equipe dona do SaaS, fora do CRM das
 * imobiliárias. Só entra quem está em PLATFORM_ADMIN_EMAILS com e-mail
 * confirmado; o resto recebe 404 (sem pista de que a área existe).
 *
 * Defesa em profundidade: o layout confere o administrador, mas layouts não
 * rodam de novo na navegação pelo menu. Por isso cada página, cada rota e cada
 * Server Action do console chamam `requirePlatformAdmin()`/`getPlatformAdmin()`
 * de novo, e as RPCs globais conferem mais uma vez (lib/plataforma/rpc.ts).
 */
export default async function PlatformConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // cookies() antes da checagem: o console é sempre dinâmico, mesmo num build
  // sem PLATFORM_ADMIN_EMAILS (senão o 404 poderia virar página estática).
  const cookieStore = await cookies()
  const admin = await requirePlatformAdmin()
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"
  const organizations = await loadOwnOrganizations(admin.id)

  return (
    <Toaster>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <ConsoleSidebar
          adminEmail={admin.email}
          organizations={organizations}
          tenancyMode={getTenancyMode()}
        />
        <SidebarInset className="min-w-0">
          <ConsoleHeader />
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </Toaster>
  )
}
