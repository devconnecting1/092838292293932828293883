import Link from "next/link"
import { ArrowUpRightIcon, HandCoinsIcon } from "lucide-react"

import { formatBRL } from "@workspace/core/billing/format"
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
import { Skeleton } from "@workspace/ui/components/skeleton"

import { isCommissionAuditor, COMMISSIONS_PATH } from "@/lib/comissoes/permissions"
import { getCommissionSummary } from "@/lib/comissoes/queries"
import type { Role } from "@/lib/auth/roles"
import { createClient } from "@/lib/supabase/server"

/**
 * Resumo de comissão no painel — onde o corretor já olha todo dia. Dono,
 * gerente e financeiro veem o total da imobiliária; os demais veem o próprio.
 */
export async function PainelCommissionCard({ userId, role }: { userId: string; role: Role }) {
  const supabase = await createClient()
  const auditor = isCommissionAuditor(role)
  const summary = await getCommissionSummary(supabase, auditor ? null : userId)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>
          {auditor ? "Comissões da imobiliária" : "Minhas comissões"}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {formatBRL(summary.pendingCents)}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={COMMISSIONS_PATH} />}
            nativeButton={false}
          >
            <HandCoinsIcon />
            <span className="sr-only">Abrir comissões</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {summary.shares === 0
          ? "Nenhuma comissão registrada ainda. Ela nasce quando uma proposta é aceita."
          : `${formatBRL(summary.paidCents)} já pagos em ${summary.deals} ${
              summary.deals === 1 ? "negócio" : "negócios"
            }.`}
      </CardContent>
      <CardFooter>
        <Button
          variant="link"
          size="sm"
          className="px-0"
          render={<Link href={COMMISSIONS_PATH} />}
          nativeButton={false}
        >
          Ver o extrato
          <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  )
}

export function PainelCommissionCardSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-full max-w-sm" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-4 w-28" />
      </CardFooter>
    </Card>
  )
}
