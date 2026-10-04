"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { ChevronsUpDownIcon, LayoutGridIcon, PlusIcon, ShieldCheckIcon } from "lucide-react"

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

import { findNavMatch } from "@/components/crm/nav-config"
import { getInitials } from "@/components/crm/utils"
import { switchOrganization } from "@/lib/auth/actions"
import { HOME_PATH, ONBOARDING_PATH, TENANT_PICKER_PATH } from "@/lib/auth/routes"
import type { TenancyMode } from "@/lib/tenant/urls"

export type OrganizationOption = {
  id: string
  name: string
  roleLabel: string
  /**
   * Origem do subdomínio da imobiliária (modo subdomain, montada no servidor).
   * null no modo single-host ou quando o slug não serve como subdomínio.
   */
  origin: string | null
}

/**
 * Troca de imobiliária:
 * - subdomain: navega para o subdomínio (nada é gravado; o servidor confere a membership);
 * - single-host: grava a escolha num cookie validado no servidor e recarrega.
 *
 * Para a equipe da plataforma, o mesmo menu leva ao Console da Plataforma (e o
 * console tem o menu inverso, de volta às imobiliárias).
 */
export function OrganizationSwitcher({
  organizations,
  currentOrganizationId,
  appOrigin,
  tenancyMode,
  platformConsoleHref = null,
}: {
  organizations: OrganizationOption[]
  currentOrganizationId: string
  /** Origem do domínio raiz; "" no host único (links relativos). */
  appOrigin: string
  tenancyMode: TenancyMode
  /** Endereço do Console da Plataforma; null para quem não é da equipe (conferido no servidor). */
  platformConsoleHref?: string | null
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = React.useTransition()
  const [navigatingId, setNavigatingId] = React.useState<string | null>(null)
  const isSubdomain = tenancyMode === "subdomain"
  const isBusy = isPending || navigatingId !== null

  const current =
    organizations.find((organization) => organization.id === currentOrganizationId) ??
    organizations[0]

  if (!current) {
    return null
  }

  function handleSelect(organizationId: string) {
    if (organizationId === current?.id) {
      return
    }

    // Telas de detalhe pertencem à imobiliária anterior: abre a mesma seção na outra.
    const section = findNavMatch(pathname)?.item.url ?? HOME_PATH

    if (isSubdomain) {
      const target = organizations.find((organization) => organization.id === organizationId)

      if (!target?.origin) {
        toast.add({
          title: "Não foi possível abrir esta imobiliária",
          description: "O endereço dela não é válido. Fale com o suporte.",
          type: "error",
        })
        return
      }

      setNavigatingId(organizationId)
      window.location.assign(`${target.origin}${section}`)
      return
    }

    startTransition(async () => {
      const result = await switchOrganization(organizationId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível trocar de imobiliária",
          description: result.error,
          type: "error",
        })
        return
      }

      if (section !== pathname) {
        router.push(section)
      } else {
        router.refresh()
      }
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
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {getInitials(current.name)}
            </div>
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{current.name}</span>
              <span className="truncate text-xs">{current.roleLabel}</span>
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
              <DropdownMenuLabel>Imobiliárias</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={current.id}
                onValueChange={(value) => handleSelect(String(value))}
              >
                {organizations.map((organization) => (
                  <DropdownMenuRadioItem
                    key={organization.id}
                    value={organization.id}
                    disabled={isBusy || (isSubdomain && !organization.origin)}
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
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            {platformConsoleHref ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Equipe da plataforma</DropdownMenuLabel>
                  <DropdownMenuItem
                    render={<a href={platformConsoleHref} />}
                    disabled={isBusy}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                      <ShieldCheckIcon />
                    </div>
                    <div className="grid flex-1 text-start leading-tight">
                      <span className="truncate">Console da Plataforma</span>
                      <span className="truncate text-xs text-muted-foreground">
                        Área de desenvolvedor
                      </span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {organizations.length > 1 ? (
                <DropdownMenuItem
                  render={<a href={`${appOrigin}${TENANT_PICKER_PATH}`} />}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                    <LayoutGridIcon />
                  </div>
                  <span className="font-medium text-muted-foreground">Todas as imobiliárias</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                render={<a href={`${appOrigin}${ONBOARDING_PATH}`} />}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <PlusIcon />
                </div>
                <span className="font-medium text-muted-foreground">Nova imobiliária</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
