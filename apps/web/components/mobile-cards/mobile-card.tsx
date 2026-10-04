import * as React from "react"
import { cn } from "cn"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

/**
 * Listas em cartões para o celular: abaixo de 640 px (o `sm` do Tailwind) a
 * tabela da tela some (`max-sm:hidden`) e esta lista aparece no lugar, sem
 * rolagem lateral. Acima disso, a tabela continua como sempre.
 */
export function MobileCardList({ className, ...props }: React.ComponentProps<"ul">) {
  // `role="list"` explícito: sem marcador, o Safari tira a semântica de lista.
  return <ul role="list" className={cn("flex flex-col gap-3 sm:hidden", className)} {...props} />
}

export type MobileCardFact = {
  label: string
  value: React.ReactNode
}

type MobileCardProps = {
  /** Nome do registro (texto, link ou botão que abre o detalhe). */
  title: React.ReactNode
  description?: React.ReactNode
  /** Menu com as demais ações, no canto do cartão. */
  menu?: React.ReactNode
  /** Selos de estado (fora do prazo, vencida, status); a linha some se ficar vazia. */
  badges?: React.ReactNode
  /** 2 ou 3 informações principais, em pares rótulo e valor. */
  facts?: MobileCardFact[]
  /** Controle extra no corpo do cartão (por exemplo, a etapa do lead). */
  children?: React.ReactNode
  /** Ações mais usadas, no rodapé. Cada filho direto vira área de toque de 44 px. */
  actions?: React.ReactNode
  /** Atraso ou pendência que pede atenção (mesmo tom da linha na tabela). */
  highlight?: boolean
  className?: string
}

export function MobileCard({
  title,
  description,
  menu,
  badges,
  facts,
  children,
  actions,
  highlight = false,
  className,
}: MobileCardProps) {
  const hasFacts = Boolean(facts && facts.length > 0)

  return (
    <li className="min-w-0">
      <Card
        size="sm"
        className={cn(highlight && "bg-destructive/5 ring-destructive/30", className)}
      >
        <CardHeader>
          <CardTitle className="min-w-0 wrap-break-word">{title}</CardTitle>
          {description ? (
            <CardDescription className="min-w-0 wrap-break-word">{description}</CardDescription>
          ) : null}
          {menu ? <CardAction>{menu}</CardAction> : null}
        </CardHeader>

        {badges || hasFacts || children ? (
          <CardContent className="flex min-w-0 flex-col gap-3">
            {/* `empty:hidden`: sem selo para mostrar, a linha não ocupa espaço. */}
            {badges ? <div className="flex flex-wrap gap-1 empty:hidden">{badges}</div> : null}
            {hasFacts ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5">
                {facts?.map((fact) => (
                  <React.Fragment key={fact.label}>
                    <dt className="text-muted-foreground">{fact.label}</dt>
                    <dd className="min-w-0 wrap-break-word">{fact.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
            {children}
          </CardContent>
        ) : null}

        {actions ? (
          // Botões com altura de 44 px que dividem a largura e quebram de linha
          // em telas muito estreitas (320 px) em vez de vazar para o lado.
          <CardFooter className="flex-wrap gap-2 *:h-11 *:min-w-11 *:flex-auto *:text-sm">
            {actions}
          </CardFooter>
        ) : null}
      </Card>
    </li>
  )
}
