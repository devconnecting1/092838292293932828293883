"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar"

import { isNavItemActiveWithExtras, type NavGroup } from "@/components/crm/nav-config"

export function NavMain({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <>
      {groups.map((group, index) => (
        <SidebarGroup key={group.title || index}>
          {group.title ? (
            <SidebarGroupLabel render={group.url ? <Link href={group.url} /> : undefined}>
              {group.title}
            </SidebarGroupLabel>
          ) : null}
          <SidebarMenu>
            {group.items.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  render={<Link href={item.url} />}
                  isActive={isNavItemActiveWithExtras(pathname, item)}
                  tooltip={item.title}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false)
                  }}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  )
}
