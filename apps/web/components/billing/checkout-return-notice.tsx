"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CircleCheckIcon, InfoIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

/** Intervalo e tentativas de atualização enquanto o webhook não confirma (≈ 2 min). */
const REFRESH_INTERVAL_MS = 4000
const MAX_REFRESHES = 30

export type CheckoutReturnStatus = "sucesso" | "cancelado"

type CheckoutReturnNoticeProps = {
  status: CheckoutReturnStatus
  /** O resumo já indica assinatura ativa (confirmada pelo webhook, não pelo redirect). */
  confirmed: boolean
}

export function CheckoutReturnNotice({ status, confirmed }: CheckoutReturnNoticeProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [refreshes, setRefreshes] = React.useState(0)
  const waiting = status === "sucesso" && !confirmed

  React.useEffect(() => {
    if (!waiting || refreshes >= MAX_REFRESHES) {
      return
    }

    const timer = window.setTimeout(() => {
      setRefreshes((count) => count + 1)
      router.refresh()
    }, REFRESH_INTERVAL_MS)

    return () => window.clearTimeout(timer)
  }, [waiting, refreshes, router])

  function dismiss() {
    // Só o retorno do pagamento some: outros parâmetros (ex.: ?imobiliaria=)
    // continuam na URL.
    const params = new URLSearchParams(searchParams)
    params.delete("checkout")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const dismissAction = (
    <AlertAction>
      <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
        Fechar
      </Button>
    </AlertAction>
  )

  if (status === "cancelado") {
    return (
      <Alert role="status">
        <InfoIcon />
        <AlertTitle>Pagamento não concluído</AlertTitle>
        <AlertDescription>
          Você saiu do pagamento antes de finalizar. Nada foi cobrado e o plano continua como
          estava.
        </AlertDescription>
        {dismissAction}
      </Alert>
    )
  }

  if (confirmed) {
    return (
      <Alert variant="success" role="status">
        <CircleCheckIcon />
        <AlertTitle>Assinatura confirmada</AlertTitle>
        <AlertDescription>
          Pagamento recebido. Os recursos do plano já estão liberados.
        </AlertDescription>
        {dismissAction}
      </Alert>
    )
  }

  if (refreshes >= MAX_REFRESHES) {
    return (
      <Alert role="status">
        <InfoIcon />
        <AlertTitle>Ainda aguardando a confirmação</AlertTitle>
        <AlertDescription>
          A confirmação pode levar alguns minutos (no boleto, até 3 dias úteis). Não é preciso pagar
          de novo: esta página mostra a assinatura assim que a Stripe confirmar.
        </AlertDescription>
        <AlertAction>
          <Button type="button" variant="outline" size="sm" onClick={() => setRefreshes(0)}>
            Verificar de novo
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  return (
    <Alert role="status" aria-busy="true">
      <Spinner aria-hidden="true" />
      <AlertTitle>Pagamento em processamento</AlertTitle>
      <AlertDescription>
        Atualizaremos quando a Stripe confirmar. Não é preciso pagar de novo nem sair desta página.
      </AlertDescription>
    </Alert>
  )
}
