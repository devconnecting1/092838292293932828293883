import Link from "next/link"
import { ArrowUpRightIcon, FileClockIcon } from "lucide-react"

import {
  AUTHORIZATION_EXPIRING_WINDOW_DAYS,
  describeAuthorizationDeadline,
} from "@workspace/core/properties/authorization-alerts"
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

import { formatDateOnly } from "@/components/imoveis/detail/format"
import { propertyTabHref } from "@/components/imoveis/detail/tabs"
import { getAuthorizationDashboard } from "@/lib/imoveis/authorization-dashboard"
import { createClient } from "@/lib/supabase/server"

const EXPIRING_HREF = "/imoveis?autorizacao=vencendo"
const EXPIRED_HREF = "/imoveis?autorizacao=vencida"

const numberFormat = new Intl.NumberFormat("pt-BR")

function deadlineLabel(daysLeft: number) {
  const text = describeAuthorizationDeadline(daysLeft)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Autorizações de venda/locação que vencem nos próximos 30 dias, no Painel —
 * onde a equipe olha todo dia. Carrega sozinho (Suspense) e nunca derruba o
 * painel: sem dados, mostra o aviso de que não carregou.
 */
export async function AuthorizationAlertsCard({ organizationId }: { organizationId: string }) {
  const supabase = await createClient()
  const dashboard = await getAuthorizationDashboard(supabase, organizationId)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>
          Autorizações vencendo em {AUTHORIZATION_EXPIRING_WINDOW_DAYS} dias
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {dashboard ? numberFormat.format(dashboard.expiringTotal) : "—"}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={EXPIRING_HREF} />}
            nativeButton={false}
          >
            <FileClockIcon />
            <span className="sr-only">Ver imóveis com autorização vencendo</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!dashboard ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as autorizações agora. Recarregue a página.
          </p>
        ) : dashboard.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma autorização de imóvel em carteira vence nos próximos{" "}
            {AUTHORIZATION_EXPIRING_WINDOW_DAYS} dias.
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {dashboard.items.map((item) => (
              <Item
                key={item.propertyId}
                variant="outline"
                size="sm"
                render={<Link href={propertyTabHref(item.propertyId, "autorizacao")} />}
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {item.code}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {[item.place, `até ${formatDateOnly(item.endsOn)}`].filter(Boolean).join(" · ")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="flex-wrap justify-end">
                  {item.exclusive ? <Badge variant="secondary">Exclusiva</Badge> : null}
                  <Badge variant={item.daysLeft <= 7 ? "destructive" : "outline"}>
                    {deadlineLabel(item.daysLeft)}
                  </Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-x-4 gap-y-1">
        <Button
          variant="link"
          size="sm"
          className="px-0"
          render={<Link href={EXPIRING_HREF} />}
          nativeButton={false}
        >
          Ver todas
          <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
        {dashboard && dashboard.expiredTotal > 0 ? (
          <Button
            variant="link"
            size="sm"
            className="px-0 text-destructive"
            render={<Link href={EXPIRED_HREF} />}
            nativeButton={false}
          >
            {dashboard.expiredTotal === 1
              ? "1 imóvel com autorização vencida"
              : `${numberFormat.format(dashboard.expiredTotal)} imóveis com autorização vencida`}
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export function AuthorizationAlertsCardSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-16" />
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
