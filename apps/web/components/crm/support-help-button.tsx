"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { LifeBuoyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { getSupportContact } from "@/components/crm/support"

function subscribeToNothing() {
  return () => {}
}

/** Origem do site só no navegador (no servidor, vazia), sem aviso de hidratação. */
function useOrigin() {
  return React.useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => ""
  )
}

type SupportHelpButtonProps = Pick<React.ComponentProps<typeof Button>, "variant" | "className"> & {
  /** Código do erro (digest) para a mensagem pronta, na página de erro. */
  errorCode?: string | null
  label?: string
}

/**
 * Botão "Ajuda": abre o WhatsApp do suporte com a mensagem pronta (página atual
 * e, na página de erro, o código do erro) ou, sem WhatsApp configurado, um
 * e-mail ao suporte. Sem nenhum contato configurado, não aparece.
 */
export function SupportHelpButton({
  errorCode,
  label = "Ajuda",
  variant = "outline",
  className,
}: SupportHelpButtonProps) {
  const pathname = usePathname()
  const origin = useOrigin()
  const contact = getSupportContact({ origin, pathname, errorCode })

  if (!contact) {
    return null
  }

  const isWhatsapp = contact.channel === "whatsapp"

  return (
    <Button
      variant={variant}
      className={className}
      nativeButton={false}
      render={
        <a
          href={contact.href}
          // O WhatsApp abre em outra aba (ou no app); o e-mail, no programa de e-mail.
          target={isWhatsapp ? "_blank" : undefined}
          rel={isWhatsapp ? "noopener noreferrer" : undefined}
        />
      }
    >
      <LifeBuoyIcon data-icon="inline-start" />
      {label}
      <span className="sr-only">
        {isWhatsapp
          ? " (abre uma conversa com o suporte no WhatsApp)"
          : " (abre um e-mail para o suporte)"}
      </span>
    </Button>
  )
}
