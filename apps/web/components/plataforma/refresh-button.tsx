"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCwIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

/** Refaz as consultas da página no servidor (sem recarregar o navegador). */
export function RefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RefreshCwIcon data-icon="inline-start" />
      )}
      {isPending ? "Atualizando..." : "Atualizar"}
    </Button>
  )
}
