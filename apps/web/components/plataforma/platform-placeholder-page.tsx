import Link from "next/link"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { getPlatformNavItem, PLATFORM_HEALTH_PATH } from "@/components/plataforma/nav-config"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"

/**
 * Módulo do console ainda sem página: "Em construção", sem erro. Confere o
 * administrador de novo (o layout não roda de novo na navegação pelo menu).
 */
export async function PlatformPlaceholderPage({ url }: { url: string }) {
  await requirePlatformAdmin()

  const item = getPlatformNavItem(url)
  const Icon = item.icon

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeading title={item.title} description={item.description} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>Em construção</EmptyTitle>
          <EmptyDescription>
            Este módulo do console ainda está sendo desenvolvido. Enquanto isso, acompanhe a saúde
            do sistema.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            render={<Link href={PLATFORM_HEALTH_PATH} />}
            nativeButton={false}
          >
            Ver a saúde do sistema
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
