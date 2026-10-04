import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Faixa de aviso. A variante diz a GRAVIDADE, e a gravidade escolhe a cor do
 * fundo — do mais fraco ao mais forte:
 *
 * - `default`     recado comum, informação: fundo neutro, como sempre foi.
 * - `maintenance` manutenção programada: azul suave.
 * - `warning`     algo vai falhar, prazo vencendo, cota acabando: âmbar suave.
 * - `destructive` problema em andamento que afeta o cliente (incidente de
 *                 impacto grande, modo leitura, exclusão agendada, erro que
 *                 barrou a ação): vermelho suave.
 * - `critical`    crítico e exige ação imediata: fundo cheio, texto invertido.
 *
 * Fora da escala: `success`, para confirmar que deu certo.
 *
 * Nos níveis com fundo tingido a cor fica no fundo e o texto continua escuro e
 * quase neutro — nunca texto vermelho sobre branco. Só `critical` inverte, e
 * por isso vale a regra: no máximo uma faixa de fundo cheio por tela; se tudo
 * for colorido, nada se destaca.
 *
 * A cor nunca é o único sinal: mantenha o ícone e o texto que já dizem de que
 * tipo é o aviso (os tokens e os contrastes medidos estão em
 * packages/ui/src/styles/globals.css).
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        maintenance:
          "border-notice-maintenance-foreground/25 bg-notice-maintenance text-notice-maintenance-foreground *:data-[slot=alert-description]:text-notice-maintenance-foreground/90",
        warning:
          "border-notice-warning-foreground/25 bg-notice-warning text-notice-warning-foreground *:data-[slot=alert-description]:text-notice-warning-foreground/90",
        destructive:
          "border-notice-destructive-foreground/25 bg-notice-destructive text-notice-destructive-foreground *:data-[slot=alert-description]:text-notice-destructive-foreground/90",
        // Único com fundo cheio: o link não pode escurecer para --foreground
        // (2,85:1 sobre o vermelho), então fica na cor invertida do próprio texto.
        critical:
          "border-notice-critical bg-notice-critical text-notice-critical-foreground *:data-[slot=alert-description]:text-notice-critical-foreground/90 *:data-[slot=alert-description]:[&_a]:hover:text-current *:data-[slot=alert-title]:[&_a]:hover:text-current",
        success:
          "border-notice-success-foreground/25 bg-notice-success text-notice-success-foreground *:data-[slot=alert-description]:text-notice-success-foreground/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute end-2 top-2", className)} {...props} />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
