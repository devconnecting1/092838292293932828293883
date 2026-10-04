"use client"

import * as React from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@workspace/ui/components/sidebar"

import { getNavGroupsForRole } from "@/components/crm/nav-config"
import { NavMain } from "@/components/crm/nav-main"
import { NavUser, type NavUserData } from "@/components/crm/nav-user"
import {
  OrganizationSwitcher,
  type OrganizationOption,
} from "@/components/crm/organization-switcher"
import type { Role } from "@/lib/auth/roles"
import type { TenancyMode } from "@/lib/tenant/urls"

export function CrmSidebar({
  organizations,
  currentOrganizationId,
  appOrigin,
  tenancyMode,
  role,
  user,
  platformConsoleHref = null,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  organizations: OrganizationOption[]
  currentOrganizationId: string
  /** Origem do domínio raiz (escolha de imobiliária e onboarding); "" no host único. */
  appOrigin: string
  tenancyMode: TenancyMode
  role: Role
  user: NavUserData
  /** Atalho para o Console da Plataforma (só equipe da plataforma; conferido no servidor). */
  platformConsoleHref?: string | null
}) {
  const groups = React.useMemo(() => getNavGroupsForRole(role), [role])

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <OrganizationSwitcher
          organizations={organizations}
          currentOrganizationId={currentOrganizationId}
          appOrigin={appOrigin}
          tenancyMode={tenancyMode}
          platformConsoleHref={platformConsoleHref}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
