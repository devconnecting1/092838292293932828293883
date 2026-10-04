import type { Metadata } from "next"
import Link from "next/link"

import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { getSettingsSectionsForRole } from "@/components/shared/settings-config"
import { requireMembership } from "@/lib/auth/session"

export const metadata: Metadata = {
  title: "Configurações",
}

const ITEM_CLASS = "min-h-18 items-start"
const MEDIA_CLASS = "size-9 rounded-md bg-muted text-muted-foreground [&_svg]:size-5"

/** Índice de configurações no estilo Stripe: seções em grade de até 3 colunas. */
export default async function ConfiguracoesPage() {
  const { membership } = await requireMembership()
  const sections = getSettingsSectionsForRole(membership.role)

  return (
    <PageShell
      header={
        <PageHeading
          title="Configurações"
          description="Sua conta, os dados da imobiliária e as integrações do CRM."
        />
      }
    >
      {sections.map((section, index) => {
        const headingId = `configuracoes-secao-${index}`

        return (
          <section key={section.title} aria-labelledby={headingId} className="flex flex-col gap-2">
            <h2
              id={headingId}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {section.title}
            </h2>
            <ul className="grid gap-2 @min-[40rem]/page:grid-cols-2 @min-[60rem]/page:grid-cols-3">
              {section.items.map((item) => (
                <li key={item.title} className="flex">
                  {item.href ? (
                    <Item render={<Link href={item.href} />} className={ITEM_CLASS}>
                      <ItemMedia className={MEDIA_CLASS}>
                        <item.icon aria-hidden="true" />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle>{item.title}</ItemTitle>
                        <ItemDescription>{item.description}</ItemDescription>
                      </ItemContent>
                    </Item>
                  ) : (
                    <Item aria-disabled="true" className={ITEM_CLASS}>
                      <ItemMedia className={MEDIA_CLASS}>
                        <item.icon aria-hidden="true" />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="text-muted-foreground">
                          {item.title}
                          <Badge variant="secondary">Em breve</Badge>
                        </ItemTitle>
                        <ItemDescription>{item.description}</ItemDescription>
                      </ItemContent>
                    </Item>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </PageShell>
  )
}
