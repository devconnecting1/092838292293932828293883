"use client"

import { ExternalLinkIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { useBillingRedirect } from "@/components/billing/use-billing-redirect"
import { openBillingPortal } from "@/lib/billing/actions"

/** Atalhos do portal: só pagamento e cancelamento (a troca de plano é feita no app). */
type PortalFlow = "payment_method_update" | "subscription_cancel"

type BillingPortalButtonProps = {
  flow?: PortalFlow
  disabled?: boolean
  /** Id do texto que explica por que o botão está desabilitado. */
  describedBy?: string
  variant?: "default" | "outline" | "secondary" | "ghost" | "link"
  children?: React.ReactNode
}

/** Abre o Customer Portal da Stripe (forma de pagamento, faturas e cancelamento). */
export function BillingPortalButton({
  flow,
  disabled = false,
  describedBy,
  variant = "outline",
  children = "Gerenciar pagamento e faturas",
}: BillingPortalButtonProps) {
  const { busy, run } = useBillingRedirect()
  const isBusy = busy !== null

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled || isBusy}
      aria-describedby={describedBy}
      onClick={() => {
        void run(
          "portal",
          () => openBillingPortal(flow ? { flow } : undefined),
          "Não foi possível abrir o portal de pagamento"
        )
      }}
    >
      {isBusy ? (
        <Spinner data-icon="inline-start" aria-label="Abrindo" />
      ) : (
        <ExternalLinkIcon data-icon="inline-start" />
      )}
      {children}
    </Button>
  )
}
