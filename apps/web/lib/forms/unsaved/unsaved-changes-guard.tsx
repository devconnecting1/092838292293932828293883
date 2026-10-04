"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

/**
 * Link interno clicado que sairia desta página. Null para clique com
 * modificador, nova aba, download, âncora na mesma página ou outra origem
 * (nesse caso o navegador já pergunta pelo beforeunload).
 */
function getLeavingHref(event: MouseEvent): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }

  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null

  if (!(anchor instanceof HTMLAnchorElement)) return null
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null

  let url: URL

  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }

  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return null
  }

  return `${url.pathname}${url.search}${url.hash}`
}

type UnsavedChangesGuardProps = {
  /** Há alterações não salvas? */
  when: boolean
}

/**
 * Aviso ao sair com alterações não salvas: pergunta do navegador ao fechar ou
 * recarregar a aba (beforeunload) e confirmação ao clicar em link interno.
 * Voltar pelo histórico não é interceptado; o rascunho local cobre esse caso.
 */
export function UnsavedChangesGuard({ when }: UnsavedChangesGuardProps) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!when) return

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Navegadores antigos só perguntam com returnValue preenchido.
      event.returnValue = ""
    }

    function onClick(event: MouseEvent) {
      const href = getLeavingHref(event)
      if (!href) return

      // Captura no document: o Link do Next nem chega a receber o clique.
      event.preventDefault()
      event.stopPropagation()
      setPendingHref(href)
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [when])

  function leave() {
    const href = pendingHref
    setPendingHref(null)
    if (href) router.push(href)
  }

  return (
    <AlertDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
          <AlertDialogDescription>
            As alterações deste formulário ainda não foram salvas no sistema.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={leave}>
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
