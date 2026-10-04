import { CheckIcon, EyeIcon, XIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

// Texto fiel ao recorte do banco (private.report_member_scope, can_view_sales_goal,
// report_forecast_proposals e report_lead_sources na migração
// 20260917012608_gestao_comercial_equipes_metas.sql).

const SEES = [
  "Nos Relatórios: os números somados dos membros das equipes que lidera, e os dele mesmo (por corretor, funil, origem do lead e motivos de perda).",
  "Metas: as metas da própria equipe e de cada membro dela.",
  "Previsão de vendas: as propostas em aberto da equipe, sem dados do cliente.",
]

const DOES_NOT_SEE = [
  "A lista de leads e clientes dos colegas, com telefone e e-mail: o acesso a cadastros continua o do papel dele.",
  "Números de outras equipes ou de corretores de fora, mesmo mudando o filtro ou o link.",
  "Investimento em marketing e custo por lead (só dono e gerente, na visão da imobiliária inteira).",
  "Editar equipes, metas ou propostas dos colegas.",
]

export function LeaderVisibilityCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeIcon aria-hidden="true" className="size-4" />O que o líder passa a ver
        </CardTitle>
        <CardDescription>
          Ser líder não muda o papel da pessoa. Muda só o recorte dos números de gestão.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 @min-[48rem]/page:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Vê</h3>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            {SEES.map((text) => (
              <li key={text} className="flex gap-2">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Não vê</h3>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            {DOES_NOT_SEE.map((text) => (
              <li key={text} className="flex gap-2">
                <XIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
