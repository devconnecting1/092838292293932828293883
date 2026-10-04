"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Badge } from "@workspace/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"

import { findPlatformNavItem, PLATFORM_HEALTH_PATH } from "@/components/plataforma/nav-config"

export function ConsoleHeader() {
  const pathname = usePathname()
  const item = findPlatformNavItem(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex min-w-0 flex-1 items-center gap-2 ps-4">
        <SidebarTrigger className="-ms-1" />
        <Separator
          orientation="vertical"
          className="me-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink render={<Link href={PLATFORM_HEALTH_PATH} />}>
                Console da Plataforma
              </BreadcrumbLink>
            </BreadcrumbItem>
            {item ? (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">{item.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex shrink-0 items-center gap-2 pe-4">
        <Badge variant="outline">Equipe da plataforma</Badge>
      </div>
    </header>
  )
}
