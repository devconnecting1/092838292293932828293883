"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Building2Icon, ChevronsUpDownIcon, ShieldCheckIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { APP_NAME } from "@/components/crm/brand"
import type { OrganizationOption } from "@/components/crm/organization-switcher"
import { getInitials } from "@/components/crm/utils"
import { switchOrganization } from "@/lib/auth/actions"
import { HOME_PATH } from "@/lib/auth/routes"
import type { TenancyMode } from "@/lib/tenant/urls"

/** Valor do item do console no grupo de rádio (id de imobiliária é uuid, não colide). */
const CONSOLE_VALUE = "console"

/**
 * Cabeçalho do Console: mostra em que área a pessoa está e troca para o CRM de
 * uma das imobiliárias dela — o caminho inverso do atalho no menu de
 * imobiliárias do CRM. É o mesmo login: nada de "entrar como" cliente, só as
 * imobiliárias de que a própria pessoa participa.
 */
export function ConsoleWorkspaceSwitcher({
  organizations,
  tenancyMode,
}: {
  /** Imobiliárias ativas de quem está no console (vazio para conta só da equipe). */
  organizations: OrganizationOption[]
  tenancyMode: TenancyMode
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [navigatingId, setNavigatingId] = React.useState<string | null>(null)
  const isSubdomain = tenancyMode === "subdomain"
  const isBusy = isPending || navigatingId !== null

  function openOrganization(organization: OrganizationOption) {
    if (isSubdomain) {
      if (!organization.origin) {
        toast.add({
          title: "Não foi possível abrir esta imobiliária",
          description: "O endereço dela não é válido. Fale com o suporte.",
          type: "error",
        })
        return
      }

      setNavigatingId(organization.id)
      window.location.assign(`${organization.origin}${HOME_PATH}`)
      return
    }

    // Host único: grava a imobiliária escolhida (validada no servidor) e abre o painel.
    startTransition(async () => {
      const result = await switchOrganization(organization.id)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível abrir esta imobiliária",
          description: result.error,
          type: "error",
        })
        return
      }

      if (isMobile) setOpenMobile(false)
      router.push(HOME_PATH)
    })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip="Console da Plataforma"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheckIcon />
            </div>
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">Console da Plataforma</span>
              <span className="truncate text-xs">{APP_NAME}</span>
            </div>
            {isBusy ? <Spinner className="ms-auto" /> : <ChevronsUpDownIcon className="ms-auto" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-60"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Equipe da plataforma</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={CONSOLE_VALUE}>
                <DropdownMenuRadioItem value={CONSOLE_VALUE} className="gap-2 p-2">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                    <ShieldCheckIcon />
                  </div>
                  <div className="grid flex-1 text-start leading-tight">
                    <span className="truncate">Console da Plataforma</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Área de desenvolvedor
                    </span>
                  </div>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Suas imobiliárias</DropdownMenuLabel>
              {organizations.length === 0 ? (
                <DropdownMenuItem disabled className="gap-2 p-2">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                    <Building2Icon />
                  </div>
                  <span className="text-muted-foreground">Esta conta não participa de nenhuma</span>
                </DropdownMenuItem>
              ) : (
                organizations.map((organization) => (
                  <DropdownMenuItem
                    key={organization.id}
                    disabled={isBusy || (isSubdomain && !organization.origin)}
                    onClick={() => openOrganization(organization)}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-md border text-xs">
                      {getInitials(organization.name)}
                    </div>
                    <div className="grid flex-1 text-start leading-tight">
                      <span className="truncate">{organization.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {organization.roleLabel}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
