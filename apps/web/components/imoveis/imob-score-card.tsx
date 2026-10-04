import { CircleCheckIcon, CircleDashedIcon } from "lucide-react"

import type { ImobScoreResult } from "@workspace/core/properties/imob-score"
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Progress } from "@workspace/ui/components/progress"

import { ImobScoreBadge } from "@/components/imoveis/imob-score-badge"

/** Detalhamento da Nota do Anúncio (imob_score): itens, pontos e dicas do que falta. */
export function ImobScoreCard({
  result,
  title = "Nota do Anúncio",
  description = "Qualidade do anúncio, de 0 a 100. Veja abaixo como melhorar a nota do anúncio.",
}: {
  result: ImobScoreResult
  title?: string
  description?: string
}) {
  const pending = result.items.filter((item) => !item.done)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <ImobScoreBadge score={result.score} showLabel />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={result.score} aria-label={`Nota do Anúncio: ${result.score}/100`} />
        <ItemGroup className="gap-1">
          {result.items.map((item) => (
            <Item key={item.key} size="xs">
              <ItemMedia variant="icon">
                {item.done ? (
                  <CircleCheckIcon className="text-primary" />
                ) : (
                  <CircleDashedIcon className="text-muted-foreground" />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{item.label}</ItemTitle>
                {item.done ? null : <ItemDescription>{item.hint}</ItemDescription>}
              </ItemContent>
              <ItemActions>
                <Badge variant={item.done ? "secondary" : "outline"} className="tabular-nums">
                  {item.points}/{item.max}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Anúncio completo. Nada pendente.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
