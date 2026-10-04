"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOutIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@workspace/ui/components/sidebar"

import type { OrganizationOption } from "@/components/crm/organization-switcher"
import { ConsoleWorkspaceSwitcher } from "@/components/plataforma/console-workspace-switcher"
import { isPlatformNavItemActive, PLATFORM_NAV_ITEMS } from "@/components/plataforma/nav-config"
import { cancelPushBeforeSignOut } from "@/components/push/cancel-push-on-sign-out"
import { signOut } from "@/lib/auth/actions"
import type { TenancyMode } from "@/lib/tenant/urls"

export function ConsoleSidebar({
  adminEmail,
  organizations,
  tenancyMode,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  /** E-mail confirmado de quem está no console (já conferido no servidor). */
  adminEmail: string
  /** Imobiliárias ativas da própria pessoa, para voltar ao CRM pelo cabeçalho. */
  organizations: OrganizationOption[]
  tenancyMode: TenancyMode
}) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const [isSigningOut, startSignOut] = React.useTransition()

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <ConsoleWorkspaceSwitcher organizations={organizations} tenancyMode={tenancyMode} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Equipe da plataforma</SidebarGroupLabel>
          <SidebarMenu>
            {PLATFORM_NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  render={<Link href={item.url} />}
                  isActive={isPlatformNavItemActive(pathname, item)}
                  tooltip={item.title}
                  onClick={closeOnMobile}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
                {item.status === "soon" ? <SidebarMenuBadge>Em breve</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Sair"
              disabled={isSigningOut}
              onClick={() =>
                startSignOut(async () => {
                  // Push deste aparelho sai junto com a sessão (nunca impede sair).
                  await cancelPushBeforeSignOut()
                  await signOut()
                })
              }
            >
              <LogOutIcon />
              <span className="flex min-w-0 flex-col">
                <span>{isSigningOut ? "Saindo..." : "Sair"}</span>
                <span className="truncate text-xs text-muted-foreground">{adminEmail}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
