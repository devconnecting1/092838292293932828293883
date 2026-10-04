import type { Metadata } from "next"
import { CircleAlertIcon, UsersIcon } from "lucide-react"

import {
  REFERRAL_GRACE_DAYS,
  REFERRAL_MAX_PERCENT,
  REFERRAL_PERCENT_PER_ACTIVE,
  REFERRAL_PERCENT_STEP,
  REFERRAL_STATUS_LABELS,
  REFERRAL_VALUE_CAP_PERCENT,
  type ReferralStatus,
} from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"

import { ReferralLinkCard } from "@/components/billing/referral-link-card"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { ORGANIZATION_VIEWER_ROLES } from "@/lib/auth/roles"
import { requireRole } from "@/lib/auth/session"
import {
  loadReferralPageData,
  type ReferralListItem,
  type ReferralPageData,
} from "@/lib/billing/referrals"
import type { ReferralIneligibleReason } from "@/lib/billing/rpc"
import { formatDate } from "@/lib/format"

export const metadata: Metadata = {
  title: "Indique e ganhe",
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const STATUS_BADGE_VARIANTS: Record<ReferralStatus, BadgeVariant> = {
  active: "default",
  in_grace: "secondary",
  awaiting_payment: "outline",
  lost: "destructive",
  ineligible: "outline",
}

const INELIGIBLE_REASON_LABELS: Record<ReferralIneligibleReason, string> = {
  refund: "pagamento estornado",
  dispute: "contestação de pagamento em análise",
  dispute_lost: "pagamento contestado",
  shared_members: "pessoas em comum com a sua equipe",
  same_cnpj: "mesmo CNPJ da sua imobiliária",
  duplicate_owner: "mesmo dono de outra indicação sua",
}

const HOW_IT_WORKS = [
  {
    title: "Compartilhe seu link",
    description: "Envie para imobiliárias e corretores que ainda não usam o CRM.",
  },
  {
    title: "A indicada assina",
    description: "Ela cria a conta pelo seu link e contrata um plano pago.",
  },
  {
    title: "Você ganha desconto",
    description: `Depois de ${REFERRAL_GRACE_DAYS} dias de assinatura paga, cada indicação ativa soma ${REFERRAL_PERCENT_PER_ACTIVE}% na sua mensalidade.`,
  },
]

const RULES = [
  `Cada indicação ativa vale ${REFERRAL_PERCENT_PER_ACTIVE}% da mensalidade do seu plano, somando até ${REFERRAL_MAX_PERCENT}% (mensalidade grátis).`,
  `A indicação conta ${REFERRAL_GRACE_DAYS} dias depois da primeira fatura paga e enquanto a assinatura dela estiver ativa. Se ela cancelar ou deixar de pagar, o desconto diminui.`,
  `Cada indicação rende no máximo ${REFERRAL_VALUE_CAP_PERCENT}% do valor que a indicada paga de fato pelo plano (já com descontos); o total é arredondado para baixo em degraus de ${REFERRAL_PERCENT_STEP}%.`,
  "O desconto vale só para o plano (usuários extras não entram) e só com a sua assinatura ativa.",
  "Não contam: a própria imobiliária, imobiliárias com pessoas em comum com a sua equipe, clientes que já assinaram antes e pagamentos estornados ou contestados. Vale uma indicação por conta: outras imobiliárias do mesmo dono não somam.",
]

function discountNote(data: ReferralPageData) {
  const { discount, storedPercent, updating } = data

  if (discount.applied) {
    if (updating) {
      return `Em atualização: pelas indicações de hoje o desconto passa a ${discount.percent}%. A cobrança é ajustada automaticamente.`
    }

    return storedPercent > 0
      ? "Aplicado nas próximas cobranças do seu plano."
      : `Cada indicação ativa soma ${REFERRAL_PERCENT_PER_ACTIVE}% na mensalidade.`
  }

  return discount.estimated
    ? "Estimativa: o desconto passa a valer quando você assinar, e o valor final depende do plano escolhido."
    : "O desconto acumulado passa a valer quando a assinatura estiver ativa."
}

function referralDescription(item: ReferralListItem) {
  const joined = item.createdAt ? `Cadastro em ${formatDate(item.createdAt)}` : null
  const detail =
    item.status === "in_grace" && item.graceEndsAt
      ? `conta a partir de ${formatDate(item.graceEndsAt)}`
      : item.status === "ineligible" && item.ineligibleReason
        ? `não conta: ${INELIGIBLE_REASON_LABELS[item.ineligibleReason]}`
        : null

  return [joined, detail].filter(Boolean).join(" · ")
}

function DiscountCard({ data }: { data: ReferralPageData }) {
  const { discount, storedPercent, updating } = data
  // Aplicado = o que está gravado (e na Stripe); sem assinatura ativa, o acumulado calculado.
  const shownPercent = discount.applied ? storedPercent : discount.percent
  const counters: { key: string; label: string; value: number }[] = [
    { key: "active", label: "Ativas", value: discount.counts.active },
    { key: "in_grace", label: "Em carência", value: discount.counts.in_grace },
    {
      key: "lost",
      label: "Perdidas",
      value: discount.counts.lost + discount.counts.ineligible,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seu desconto</CardTitle>
        <CardDescription>Desconto por indicações na mensalidade do plano.</CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-1">
          {discount.applied && storedPercent > 0 ? <Badge>Aplicado</Badge> : null}
          {updating ? <Badge variant="secondary">Em atualização</Badge> : null}
          {!discount.applied && discount.percent > 0 ? (
            <Badge variant="outline">A aplicar</Badge>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {shownPercent}%
          </span>
          <span className="text-sm text-muted-foreground">{discountNote(data)}</span>
        </p>
        <Progress value={shownPercent}>
          <ProgressLabel>Até a mensalidade grátis</ProgressLabel>
          <span className="ms-auto text-sm text-muted-foreground tabular-nums">
            {shownPercent}% de {REFERRAL_MAX_PERCENT}%
          </span>
        </Progress>
        <dl className="grid grid-cols-3 gap-3">
          {counters.map((counter) => (
            <div key={counter.key} className="flex flex-col gap-1 rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{counter.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{counter.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function ReferralsList({ referrals }: { referrals: ReferralListItem[] }) {
  if (referrals.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma indicação ainda</EmptyTitle>
          <EmptyDescription>
            Compartilhe seu link. As imobiliárias que criarem a conta por ele aparecem aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ItemGroup role="list" className="gap-2">
      {referrals.map((referral) => (
        <Item key={referral.key} variant="outline" role="listitem">
          <ItemContent className="min-w-0">
            <ItemTitle>{referral.displayName}</ItemTitle>
            <ItemDescription>{referralDescription(referral)}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant={STATUS_BADGE_VARIANTS[referral.status]}>
              {REFERRAL_STATUS_LABELS[referral.status]}
            </Badge>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}

export default async function IndicacoesPage() {
  const { membership } = await requireRole(ORGANIZATION_VIEWER_ROLES)
  const data = await loadReferralPageData(membership.organizationId)

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Indique e ganhe"
          description="Indique o CRM e ganhe desconto na mensalidade enquanto suas indicações continuarem assinando."
        />
      }
    >
      {data ? (
        <>
          <div className="grid gap-6 @min-[56rem]/main:grid-cols-2">
            <ReferralLinkCard url={data.linkUrl} code={data.code} />
            <DiscountCard data={data} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Suas indicações</CardTitle>
              <CardDescription>
                {data.truncated
                  ? `Mostrando ${data.referrals.length} de ${data.total} indicações. `
                  : ""}
                Para proteger os dados das indicadas, mostramos só iniciais ou a primeira palavra do
                nome da empresa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReferralsList referrals={data.referrals} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não foi possível carregar suas indicações</AlertTitle>
          <AlertDescription>
            Recarregue a página em instantes. Seu desconto e suas indicações não foram afetados.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 @min-[56rem]/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Como funciona</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {HOW_IT_WORKS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regras</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-muted-foreground">
              {RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
