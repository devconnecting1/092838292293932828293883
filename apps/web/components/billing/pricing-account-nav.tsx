"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  LogOutIcon,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
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
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import type { PricingAccount } from "@/components/billing/pricing-account"
import { getInitials } from "@/components/crm/utils"
import { cancelPushBeforeSignOut } from "@/components/push/cancel-push-on-sign-out"
import { signOut, switchOrganization } from "@/lib/auth/actions"

/**
 * Conta conectada no cabeçalho de /planos: de qual imobiliária é a assinatura
 * (só as ativas, com o papel), atalho para o painel e o menu da pessoa.
 * - host único: a troca grava o cookie validado no servidor (switchOrganization);
 * - subdomain: a troca muda o ?imobiliaria= e o servidor confere nas memberships.
 */
export function PricingAccountNav({ account }: { account: PricingAccount }) {
  const router = useRouter()
  const [isSwitching, startSwitch] = React.useTransition()
  const [isSigningOut, startSignOut] = React.useTransition()
  const { organizations, user } = account
  const selected =
    organizations.find((organization) => organization.id === account.selectedOrganizationId) ?? null

  function selectOrganization(organizationId: string) {
    if (organizationId === selected?.id) {
      return
    }

    if (account.tenancyMode === "subdomain") {
      const target = organizations.find((organization) => organization.id === organizationId)

      if (!target?.plansHref) {
        toast.add({
          type: "error",
          title: "Não foi possível abrir esta imobiliária",
          description: "O endereço dela não é válido. Fale com o suporte.",
        })
        return
      }

      const href = target.plansHref
      startSwitch(() => router.push(href, { scroll: false }))
      return
    }

    startSwitch(async () => {
      const result = await switchOrganization(organizationId)

      if (!result.ok) {
        toast.add({
          type: "error",
          title: "Não foi possível trocar de imobiliária",
          description: result.error,
        })
        return
      }

      router.refresh()
    })
  }

  return (
    <nav aria-label="Conta" className="flex min-w-0 items-center gap-2">
      {selected && organizations.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="max-w-52 min-w-0 sm:max-w-80" />}
            aria-label={`Assinatura de: ${selected.name}. Trocar de imobiliária`}
          >
            <span className="sr-only sm:not-sr-only sm:text-muted-foreground">Assinatura de:</span>
            <span className="truncate">{selected.name}</span>
            {isSwitching ? (
              <Spinner data-icon="inline-end" aria-label="Trocando" />
            ) : (
              <ChevronDownIcon data-icon="inline-end" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Ver a assinatura de</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selected.id}
                onValueChange={(value) => selectOrganization(String(value))}
              >
                {organizations.map((organization) => (
                  <DropdownMenuRadioItem
                    key={organization.id}
                    value={organization.id}
                    disabled={isSwitching}
                  >
                    <span className="grid flex-1 text-start leading-tight">
                      <span className="truncate">{organization.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {organization.roleLabel}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : selected ? (
        <p className="min-w-0 truncate text-sm">
          <span className="sr-only sm:not-sr-only sm:text-muted-foreground">Assinatura de: </span>
          <span className="font-medium">{selected.name}</span>
        </p>
      ) : null}

      <Button
        variant="ghost"
        className="hidden md:inline-flex"
        render={<a href={account.panelHref} />}
        nativeButton={false}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Voltar ao painel
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" className="rounded-full" />}
          aria-label={`Conta de ${user.name}`}
        >
          <Avatar>
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col font-normal">
              <span className="truncate font-medium text-foreground">{user.name}</span>
              {user.email ? <span className="truncate">{user.email}</span> : null}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem render={<a href={account.panelHref} />}>
              <LayoutDashboardIcon />
              Voltar ao painel
            </DropdownMenuItem>
            {account.subscriptionHref ? (
              <DropdownMenuItem render={<a href={account.subscriptionHref} />}>
                <CreditCardIcon />
                Assinatura e faturas
              </DropdownMenuItem>
            ) : null}
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
    </nav>
  )
}
