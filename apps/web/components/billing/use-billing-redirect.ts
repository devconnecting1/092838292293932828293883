"use client"

import * as React from "react"

import { toast } from "@workspace/ui/components/toast"

type RedirectResult = { ok: true; url: string } | { ok: false; error: string }

function isSafeRedirect(url: string) {
  try {
    const { protocol } = new URL(url)
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

/**
 * Chama uma Server Action de Checkout/Portal e redireciona para a URL da Stripe.
 * `busy` guarda a chave da ação em andamento (fica marcada até a navegação sair).
 */
export function useBillingRedirect() {
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    // Voltar da Stripe pelo histórico (bfcache) restaura a página com o botão travado.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setBusy(null)
      }
    }

    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  const run = React.useCallback(
    async (key: string, action: () => Promise<RedirectResult>, errorTitle: string) => {
      setBusy(key)

      try {
        const result = await action()

        if (result.ok && isSafeRedirect(result.url)) {
          window.location.assign(result.url)
          return
        }

        toast.add({
          type: "error",
          title: errorTitle,
          description: result.ok ? "Endereço de pagamento inválido." : result.error,
        })
      } catch {
        toast.add({
          type: "error",
          title: errorTitle,
          description: "Verifique a conexão e tente de novo em instantes.",
        })
      }

      setBusy(null)
    },
    []
  )

  return { busy, run }
}
