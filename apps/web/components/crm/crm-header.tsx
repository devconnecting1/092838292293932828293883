"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LifeBuoyIcon } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"

import { GlobalSearch } from "@/components/busca/global-search"
import { EXTRA_PAGE_TITLES, findNavMatch } from "@/components/crm/nav-config"
import { hasSupportContact } from "@/components/crm/support"
import { SupportHelpButton } from "@/components/crm/support-help-button"

const SEGMENT_LABELS: Record<string, string> = {
  novo: "Novo",
  nova: "Nova",
  editar: "Editar",
}

function labelForSegment(segment: string) {
  const label = SEGMENT_LABELS[segment]

  if (label) {
    return label
  }

  if (/^[0-9a-f-]{8,}$/i.test(segment)) {
    return "Detalhes"
  }

  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function HeaderBreadcrumb() {
  const pathname = usePathname()
  const match = findNavMatch(pathname)

  if (!match) {
    return (
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">
              {EXTRA_PAGE_TITLES[pathname] ?? "CRM"}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  const { group, item } = match
  const trail = pathname.slice(item.url.length).split("/").filter(Boolean)
  const showGroup = group.title !== item.title && group.title !== "Principal"

  // No celular a trilha fica numa linha só (a busca e a ajuda dividem o
  // cabeçalho): some o grupo e os passos do meio, e o último trunca.
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {showGroup ? (
          <>
            <BreadcrumbItem className="hidden md:block">{group.title}</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        ) : null}
        {trail.length === 0 ? (
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{item.title}</BreadcrumbPage>
          </BreadcrumbItem>
        ) : (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={item.url} />}>{item.title}</BreadcrumbLink>
            </BreadcrumbItem>
            {trail.map((segment, index) => {
              const isLast = index === trail.length - 1
              const href = `${item.url}/${trail.slice(0, index + 1).join("/")}`

              return (
                <React.Fragment key={href}>
                  <BreadcrumbSeparator className={isLast ? undefined : "hidden sm:block"} />
                  <BreadcrumbItem className={isLast ? "min-w-0" : "hidden sm:inline-flex"}>
                    {isLast ? (
                      <BreadcrumbPage className="truncate">
                        {labelForSegment(segment)}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link href={href} />}>
                        {labelForSegment(segment)}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              )
            })}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

type CrmHeaderProps = {
  /**
   * Tela "Saúde do sistema" do Console, só para a equipe da plataforma. Sem
   * NEXT_PUBLIC_SUPPORT_WHATSAPP/EMAIL, ela vê um aviso discreto no lugar do
   * botão "Ajuda"; clientes não veem nada (o botão simplesmente não aparece).
   */
  supportSetupHref?: string | null
}

export function CrmHeader({ supportSetupHref = null }: CrmHeaderProps) {
  const showSupportSetup = Boolean(supportSetupHref) && !hasSupportContact()

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex min-w-0 flex-1 items-center gap-2 ps-4">
        <SidebarTrigger className="-ms-1" />
        <Separator
          orientation="vertical"
          className="me-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <HeaderBreadcrumb />
      </div>
      {/* Busca e ajuda sempre à mão, em qualquer página e no celular. */}
      <div className="flex shrink-0 items-center gap-2 pe-4">
        <GlobalSearch />
        <SupportHelpButton />
        {showSupportSetup && supportSetupHref ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            render={<a href={supportSetupHref} />}
            nativeButton={false}
          >
            <LifeBuoyIcon data-icon="inline-start" />
            <span className="max-lg:sr-only">Configure o contato do suporte</span>
          </Button>
        ) : null}
      </div>
    </header>
  )
}
