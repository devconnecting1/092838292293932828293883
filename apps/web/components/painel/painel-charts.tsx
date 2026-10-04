import Link from "next/link"
import {
  ArrowUpRightIcon,
  ChartPieIcon,
  FunnelIcon,
  SproutIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"

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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { SupportHelpButton } from "@/components/crm/support-help-button"
import { LeadsFunnelChartView } from "@/components/painel/leads-funnel-chart"
import { LeadsWeeklyChartView } from "@/components/painel/leads-weekly-chart"
import { PropertiesStatusChartView } from "@/components/painel/properties-status-chart"
import {
  formatCompactCurrency,
  LEADS_CHART_WEEKS,
  LEADS_FUNNEL_DAYS,
  type PropertiesStatusChart,
} from "@/lib/painel/charts"
import {
  loadLeadsFunnelChart,
  loadLeadsWeeklyChart,
  loadPropertiesStatusChart,
} from "@/lib/painel/queries"

const integerFormat = new Intl.NumberFormat("pt-BR")
const decimalFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })
const percentFormat = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
})

const LOAD_ERROR_DESCRIPTION = "Recarregue a página em instantes."

type ChartEmptyProps = {
  icon: LucideIcon
  title: string
  description: string
  /** Falha de leitura: oferece o suporte (o botão só aparece com contato configurado). */
  withSupport?: boolean
}

function ChartEmpty({ icon: Icon, title, description, withSupport = false }: ChartEmptyProps) {
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {withSupport ? (
        <EmptyContent>
          <SupportHelpButton label="Chamar o suporte" />
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

function OpenModuleAction({ href, label }: { href: string; label: string }) {
  return (
    <CardAction>
      <Button variant="ghost" size="icon-sm" render={<Link href={href} />} nativeButton={false}>
        <ArrowUpRightIcon />
        <span className="sr-only">{label}</span>
      </Button>
    </CardAction>
  )
}

/** Espera de um cartão de gráfico (fallback do Suspense do Painel). */
export function PainelChartSkeleton({ title }: { title: string }) {
  return (
    <Card aria-busy="true" aria-label={`Carregando ${title}`}>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-72 w-full rounded-xl" />
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Leads por semana
// -----------------------------------------------------------------------------

export async function LeadsWeeklyCard({ organizationId }: { organizationId: string }) {
  const chart = await loadLeadsWeeklyChart(organizationId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leads por semana</CardTitle>
        <CardDescription>
          Últimas {chart?.weeks ?? LEADS_CHART_WEEKS} semanas, empilhadas por origem. A semana vai
          de segunda a domingo, no horário de Brasília.
        </CardDescription>
        <OpenModuleAction href="/leads" label="Abrir o funil de leads" />
      </CardHeader>
      <CardContent>
        {!chart ? (
          <ChartEmpty
            icon={TriangleAlertIcon}
            title="Não foi possível carregar a captação"
            description={LOAD_ERROR_DESCRIPTION}
            withSupport
          />
        ) : chart.total === 0 ? (
          <ChartEmpty
            icon={SproutIcon}
            title="Nenhum lead nas últimas semanas"
            description="Publique uma página de captação ou cadastre um lead do telefone para o gráfico começar a mostrar a captação."
          />
        ) : (
          <>
            <LeadsWeeklyChartView data={chart} />
            {/* Mesma informação do gráfico, para leitores de tela. */}
            <ul className="sr-only">
              {chart.points.map((point) => (
                <li key={point.weekStart}>
                  Semana de {point.rangeLabel}: {integerFormat.format(point.total)} lead(s).
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {chart && chart.total > 0 ? (
        <CardFooter className="text-muted-foreground">
          {integerFormat.format(chart.total)} leads entre {chart.periodLabel} · média de{" "}
          {decimalFormat.format(chart.weeklyAverage)} por semana ·{" "}
          {integerFormat.format(chart.currentWeekTotal)} nesta semana.
        </CardFooter>
      ) : null}
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Funil de leads por etapa
// -----------------------------------------------------------------------------

export async function LeadsFunnelCard({ organizationId }: { organizationId: string }) {
  const chart = await loadLeadsFunnelChart(organizationId)
  const conversion = chart && chart.total > 0 ? chart.won / chart.total : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de leads por etapa</CardTitle>
        <CardDescription>
          Leads criados nos últimos {chart?.days ?? LEADS_FUNNEL_DAYS} dias, na etapa em que estão
          agora.
        </CardDescription>
        <OpenModuleAction href="/leads" label="Abrir o funil de leads" />
      </CardHeader>
      <CardContent>
        {!chart ? (
          <ChartEmpty
            icon={TriangleAlertIcon}
            title="Não foi possível carregar o funil"
            description={LOAD_ERROR_DESCRIPTION}
            withSupport
          />
        ) : chart.total === 0 ? (
          <ChartEmpty
            icon={FunnelIcon}
            title="Funil vazio no período"
            description="Assim que entrarem leads, cada etapa vira uma barra e mostra onde o atendimento está parando."
          />
        ) : (
          <>
            <LeadsFunnelChartView data={chart} />
            {/* Mesma informação do gráfico, para leitores de tela. */}
            <ul className="sr-only">
              {chart.bars.map((bar) => (
                <li key={bar.stage}>
                  {bar.label}: {integerFormat.format(bar.total)} lead(s),{" "}
                  {percentFormat.format(bar.share)} do período.
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {chart && chart.total > 0 ? (
        <CardFooter className="text-muted-foreground">
          {integerFormat.format(chart.open)} em aberto · {integerFormat.format(chart.won)} ganhos ·{" "}
          {integerFormat.format(chart.lost)} perdidos
          {conversion === null ? "." : ` · conversão de ${percentFormat.format(conversion)}.`}
        </CardFooter>
      ) : null}
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Imóveis por status
// -----------------------------------------------------------------------------

/** Rodapé da carteira; omite venda ou locação quando a imobiliária não trabalha com aquilo. */
function propertiesFooterText(chart: PropertiesStatusChart) {
  const parts = [`${integerFormat.format(chart.total)} imóveis`]

  if (chart.saleValue > 0) {
    parts.push(`${formatCompactCurrency(chart.saleValue)} em venda`)
  }

  if (chart.rentValue > 0) {
    parts.push(`${formatCompactCurrency(chart.rentValue)} por mês em locação`)
  }

  return `${parts.join(" · ")}.`
}

export async function PropertiesStatusCard({ organizationId }: { organizationId: string }) {
  const chart = await loadPropertiesStatusChart(organizationId)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Imóveis por status</CardTitle>
        <CardDescription>
          Toda a carteira cadastrada, do rascunho ao vendido. Passe o mouse para ver o valor de cada
          status.
        </CardDescription>
        <OpenModuleAction href="/imoveis" label="Abrir os imóveis" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!chart ? (
          <ChartEmpty
            icon={TriangleAlertIcon}
            title="Não foi possível carregar a carteira"
            description={LOAD_ERROR_DESCRIPTION}
            withSupport
          />
        ) : chart.total === 0 ? (
          <ChartEmpty
            icon={ChartPieIcon}
            title="Nenhum imóvel cadastrado"
            description="Cadastre o primeiro imóvel para acompanhar quanto da carteira está disponível, reservado ou já negociado."
          />
        ) : (
          <>
            <PropertiesStatusChartView data={chart} />
            {/* Legenda em texto: é a leitura acessível da rosca e não depende de cor. */}
            <ul className="grid grid-cols-1 gap-x-4 gap-y-2 @sm/card:grid-cols-2">
              {chart.slices.map((slice) => (
                <li key={slice.status} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                  <span className="tabular-nums">
                    {integerFormat.format(slice.total)}
                    <span className="text-muted-foreground">
                      {" "}
                      ({percentFormat.format(slice.total / chart.total)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {chart && chart.total > 0 ? (
        <CardFooter className="text-muted-foreground">{propertiesFooterText(chart)}</CardFooter>
      ) : null}
    </Card>
  )
}
