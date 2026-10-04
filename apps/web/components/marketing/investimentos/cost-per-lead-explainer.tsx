import Link from "next/link"
import { CalculatorIcon } from "lucide-react"

import { formatBRL } from "@workspace/core/billing/format"
import {
  costPerLeadCents,
  prorateMonthlyInvestmentCents,
} from "@workspace/core/reports/marketing-investments"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

// Mesma definição do cabeçalho da migração 20260917012608_gestao_comercial_equipes_metas.sql
// ("Custo por lead") e de private.report_lead_sources.

const EXAMPLE_INVESTMENT = 300_000
const EXAMPLE_LEADS = 150
const EXAMPLE_WON = 3

export function CostPerLeadExplainer({ reportsHref }: { reportsHref: string }) {
  const perLead = costPerLeadCents(EXAMPLE_INVESTMENT, EXAMPLE_LEADS)
  const perWin = costPerLeadCents(EXAMPLE_INVESTMENT, EXAMPLE_WON)
  const halfMonth = prorateMonthlyInvestmentCents(EXAMPLE_INVESTMENT, 15, 30)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalculatorIcon aria-hidden="true" className="size-4" />
          Como o custo por lead é calculado
        </CardTitle>
        <CardDescription>
          Os números aparecem em Relatórios, aba Origem do lead, para o dono e o gerente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">Canal e campanha.</span> Campanha lançada aqui fica
            com os leads que chegaram com o mesmo utm_campaign (sem diferença de maiúsculas). O
            valor lançado sem campanha cobre o resto dos leads do canal.
          </li>
          <li>
            <span className="text-foreground">Proporcional aos dias.</span> O investimento é mensal;
            num período menor entra só a parte dos dias escolhidos. Ex.:{" "}
            {formatBRL(EXAMPLE_INVESTMENT)} no mês e um filtro de 15 dias de um mês de 30 ={" "}
            {formatBRL(halfMonth)}.
          </li>
          <li>
            <span className="text-foreground">Dividido pelos leads.</span> Custo por lead =
            investimento ÷ leads recebidos no período; custo por ganho = investimento ÷ leads
            ganhos. Ex.: {formatBRL(EXAMPLE_INVESTMENT)} com {EXAMPLE_LEADS} leads e {EXAMPLE_WON}{" "}
            ganhos = {perLead === null ? "—" : formatBRL(perLead)} por lead e{" "}
            {perWin === null ? "—" : formatBRL(perWin)} por ganho.
          </li>
          <li>
            <span className="text-foreground">Só na visão da imobiliária inteira.</span> Com filtro
            de corretor ou de equipe o custo não aparece: o gasto não é dividido por pessoa e
            inflaria o número.
          </li>
          <li>
            <span className="text-foreground">Investimento sem lead também conta.</span> Aparece com
            zero lead, para ninguém esquecer do gasto que não trouxe resultado.
          </li>
        </ol>
        <p className="mt-3 text-sm">
          <Link href={reportsHref} className="underline underline-offset-4 hover:text-primary">
            Abrir a aba Origem do lead em Relatórios
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
