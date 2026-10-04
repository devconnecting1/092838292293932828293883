import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { HOME_PATH } from "@/lib/auth/routes"

export function PageHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )
}

/** Página provisória para rotas do menu que ainda não foram construídas. */
export function PagePlaceholder({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description?: string
  icon: LucideIcon
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeading title={title} description={description} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>Em construção</EmptyTitle>
          <EmptyDescription>
            Esta área ainda está sendo desenvolvida e estará disponível em breve.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={HOME_PATH} />} nativeButton={false}>
            Voltar ao painel
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
