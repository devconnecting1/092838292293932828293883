import Link from "next/link"
import { ArrowUpRightIcon, CakeIcon, MessageCircleIcon } from "lucide-react"
import { z } from "zod"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { getFirstName } from "@/components/crm/utils"
import { formatDateKey } from "@/lib/agenda/datetime"
import { whatsappHref } from "@/lib/landing/format"
import { createClient } from "@/lib/supabase/server"

/** Hoje e os próximos 6 dias. */
const BIRTHDAY_WINDOW_DAYS = 7
const BIRTHDAY_CARD_LIMIT = 8
const CLIENTS_HREF = "/clientes"

const numberFormat = new Intl.NumberFormat("pt-BR")

const birthdaysSchema = z.object({
  total: z.coerce.number().int().nonnegative().catch(0),
  items: z
    .array(
      z.object({
        client_id: z.string(),
        name: z.string(),
        next_birthday: z.string(),
        days_until: z.number().int(),
        turning_age: z.number().int().nullable().optional(),
        phone: z.string().nullable().optional(),
      })
    )
    .catch([]),
})

type Birthdays = z.infer<typeof birthdaysSchema>

/** null = não carregou (a tela mostra o aviso; o painel continua). */
async function loadBirthdays(organizationId: string): Promise<Birthdays | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("dashboard_client_birthdays", {
      p_organization_id: organizationId,
      p_days: BIRTHDAY_WINDOW_DAYS,
      p_limit: BIRTHDAY_CARD_LIMIT,
    })

    if (error) {
      console.error(
        `[painel] falha ao carregar os aniversariantes (código ${error.code || "desconhecido"})`
      )
      return null
    }

    const parsed = birthdaysSchema.safeParse(data)
    return parsed.success ? parsed.data : null
  } catch (cause) {
    console.error(
      `[painel] falha ao carregar os aniversariantes (${cause instanceof Error ? cause.name : "erro"})`
    )
    return null
  }
}

function whenLabel(daysUntil: number, nextBirthday: string) {
  if (daysUntil === 0) return "Hoje"
  if (daysUntil === 1) return "Amanhã"

  const label = formatDateKey(nextBirthday, "weekday")
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * Clientes que fazem aniversário nos próximos 7 dias (hoje incluso), no Painel.
 * O RLS de clients decide quem aparece: o corretor vê a carteira dele, a gestão
 * vê todos. Carrega sozinho (Suspense) e nunca derruba o painel.
 */
export async function BirthdaysCard({
  organizationId,
  organizationName,
}: {
  organizationId: string
  organizationName: string
}) {
  const birthdays = await loadBirthdays(organizationId)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>Aniversariantes da semana</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {birthdays ? numberFormat.format(birthdays.total) : "—"}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={CLIENTS_HREF} />}
            nativeButton={false}
          >
            <CakeIcon />
            <span className="sr-only">Abrir clientes</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!birthdays ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar os aniversariantes agora. Recarregue a página.
          </p>
        ) : birthdays.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum cliente faz aniversário nos próximos 7 dias. Cadastre a data de nascimento na
            ficha do cliente para aparecer aqui.
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {birthdays.items.map((item) => {
              const firstName = getFirstName(item.name)
              const message = `Olá, ${firstName}! Feliz aniversário! Um abraço da equipe ${organizationName}.`
              const whatsapp = item.phone ? whatsappHref(item.phone, message) : null
              const when = whenLabel(item.days_until, item.next_birthday)

              return (
                <Item key={item.client_id} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full min-w-0">
                      <Link
                        href={`${CLIENTS_HREF}/${item.client_id}`}
                        className="truncate underline-offset-4 hover:underline"
                      >
                        {item.name}
                      </Link>
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {item.turning_age ? `${when} · faz ${item.turning_age} anos` : when}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {item.days_until === 0 ? <Badge>Hoje</Badge> : null}
                    {whatsapp ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={whatsapp} target="_blank" rel="noopener noreferrer" />}
                        nativeButton={false}
                      >
                        <MessageCircleIcon data-icon="inline-start" />
                        Parabéns
                        <span className="sr-only"> para {firstName} no WhatsApp</span>
                      </Button>
                    ) : null}
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
      {birthdays && birthdays.total > birthdays.items.length ? (
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            E mais {numberFormat.format(birthdays.total - birthdays.items.length)} nesta semana.
          </p>
        </CardFooter>
      ) : (
        <CardFooter>
          <Button
            variant="link"
            size="sm"
            className="px-0"
            render={<Link href={CLIENTS_HREF} />}
            nativeButton={false}
          >
            Ver clientes
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export function BirthdaysCardSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-12" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-4 w-24" />
      </CardFooter>
    </Card>
  )
}
