"use client"

import * as React from "react"
import { StarIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { toggleCaixaFavoriteAction } from "@/lib/caixa/actions"

/** Favorito é por pessoa: cada corretor monta a própria lista curta. */
export function CaixaFavoriteButton({
  numero,
  isFavorite,
  withLabel = false,
  className,
}: {
  numero: string
  isFavorite: boolean
  withLabel?: boolean
  className?: string
}) {
  const [favorite, setFavorite] = React.useState(isFavorite)
  const [serverValue, setServerValue] = React.useState(isFavorite)
  const [isPending, startTransition] = React.useTransition()

  // O servidor é a verdade: quando a lista recarrega com outro estado, o botão
  // se ajusta durante a renderização (sem efeito, sem render em cascata).
  if (serverValue !== isFavorite) {
    setServerValue(isFavorite)
    setFavorite(isFavorite)
  }

  function toggle() {
    const next = !favorite
    setFavorite(next)

    startTransition(async () => {
      const result = await toggleCaixaFavoriteAction(numero, next)

      if (!result.ok) {
        setFavorite(!next)
        toast.add({ title: "Não foi possível salvar", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Favoritos atualizados.", type: "success" })
    })
  }

  return (
    <Button
      variant={favorite ? "secondary" : "outline"}
      size={withLabel ? "sm" : "icon-sm"}
      onClick={toggle}
      disabled={isPending}
      aria-pressed={favorite}
      aria-label={favorite ? "Remover dos favoritos" : "Favoritar imóvel"}
      title={favorite ? "Remover dos favoritos" : "Favoritar imóvel"}
      className={className}
    >
      {isPending ? (
        <Spinner />
      ) : (
        <StarIcon
          data-icon={withLabel ? "inline-start" : undefined}
          className={cn(favorite && "fill-current")}
        />
      )}
      {withLabel ? (favorite ? "Favoritado" : "Favoritar") : null}
    </Button>
  )
}
