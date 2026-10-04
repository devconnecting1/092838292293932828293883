"use client"

import * as React from "react"
import Link from "next/link"
import { ActivityIcon, ChevronsUpDownIcon, CircleUserRoundIcon, LogOutIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar"

import { getInitials } from "@/components/crm/utils"
import { cancelPushBeforeSignOut } from "@/components/push/cancel-push-on-sign-out"
import { getStatusPageHref } from "@/components/status/links"
import { signOut } from "@/lib/auth/actions"

export type NavUserData = {
  name: string
  email: string | null
  avatarUrl: string | null
}

function UserIdentity({ user }: { user: NavUserData }) {
  return (
    <>
      <Avatar>
        {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-start text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        {user.email ? <span className="truncate text-xs">{user.email}</span> : null}
      </div>
    </>
  )
}

export function NavUser({ user }: { user: NavUserData }) {
  const { isMobile } = useSidebar()
  const [isSigningOut, startSignOut] = React.useTransition()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            <UserIdentity user={user} />
            <ChevronsUpDownIcon className="ms-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm text-foreground">
                  <UserIdentity user={user} />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link href="/perfil" />}>
                <CircleUserRoundIcon />
                Meu perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<a href={getStatusPageHref()} target="_blank" rel="noopener" />}
              >
                <ActivityIcon />
                Status do sistema
                <span className="sr-only"> (abre em nova aba)</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={isSigningOut}
                onClick={() =>
                  startSignOut(async () => {
                    // Desliga os avisos no celular deste aparelho; nunca impede sair.
                    await cancelPushBeforeSignOut()
                    await signOut()
                  })
                }
              >
                <LogOutIcon />
                {isSigningOut ? "Saindo..." : "Sair"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
