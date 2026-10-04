"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { isNavItemActive } from "@/components/crm/nav-config"
import { PageShellNavFrame } from "@/components/shared/page-shell"
import { getSettingsNavForRole, SETTINGS_INDEX_PATH } from "@/components/shared/settings-config"
import type { Role } from "@/lib/auth/roles"

/**
 * Sub-navegação das configurações. Desktop (≥ 1024 px): lista vertical por grupo.
 * Celular e tablet: abas roláveis no topo da página.
 */
export function SettingsNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const baseId = React.useId()
  const groups = getSettingsNavForRole(role)
  const items = groups.flatMap((group) => group.items)

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit text-muted-foreground"
        render={<Link href={SETTINGS_INDEX_PATH} />}
        nativeButton={false}
      >
        <ChevronLeftIcon data-icon="inline-start" />
        Configurações
      </Button>

      <ul className="flex gap-1 overflow-x-auto pb-1 lg:hidden">
        {items.map((item) => {
          const active = isNavItemActive(pathname, item.href)

          return (
            <li key={item.href} className="shrink-0">
              <Button
                variant={active ? "secondary" : "ghost"}
                size="sm"
                aria-current={active ? "page" : undefined}
                render={<Link href={item.href} />}
                nativeButton={false}
              >
                <item.icon data-icon="inline-start" />
                {item.title}
              </Button>
            </li>
          )
        })}
      </ul>

      <div className="hidden flex-col gap-4 lg:flex">
        {groups.map((group, index) => {
          const headingId = `${baseId}-grupo-${index}`

          return (
            <div key={group.title} className="flex flex-col gap-1">
              <p id={headingId} className="px-2.5 text-xs font-medium text-muted-foreground">
                {group.title}
              </p>
              <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isNavItemActive(pathname, item.href)

                  return (
                    <li key={item.href}>
                      <Button
                        variant={active ? "secondary" : "ghost"}
                        size="sm"
                        className="w-full justify-start"
                        aria-current={active ? "page" : undefined}
                        render={<Link href={item.href} />}
                        nativeButton={false}
                      >
                        <item.icon data-icon="inline-start" />
                        {item.title}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Moldura das subpáginas de configurações; o índice fica sem sub-navegação. */
export function SettingsFrame({ role, children }: { role: Role; children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === SETTINGS_INDEX_PATH) {
    return <>{children}</>
  }

  return <PageShellNavFrame nav={<SettingsNav role={role} />}>{children}</PageShellNavFrame>
}

/** Esqueleto da sub-navegação, para loading.tsx fora de /configuracoes (ex.: /perfil). */
export function SettingsNavSkeleton() {
  return (
    <div className="flex flex-col gap-3 lg:gap-4" aria-hidden="true">
      <Skeleton className="h-7 w-32" />
      <div className="flex gap-1 lg:hidden">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-7 w-24" />
        ))}
      </div>
      <div className="hidden flex-col gap-1 lg:flex">
        <Skeleton className="mx-2.5 h-3 w-20" />
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-7 w-full" />
        ))}
        <Skeleton className="mx-2.5 mt-3 h-3 w-20" />
        <Skeleton className="h-7 w-full" />
      </div>
    </div>
  )
}
