"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

/**
 * Link do convite para o Dono copiar quando o e-mail não saiu (falha ou modo
 * simulado). O link é pessoal e vale uma vez só.
 */
export function ManualInvitationLink({ message, link }: { message: string; link: string }) {
  const [copied, setCopied] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Sem permissão para a área de transferência: seleciona para copiar à mão.
      inputRef.current?.select()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <LinkIcon />
        <AlertTitle>Mande o link por outro meio</AlertTitle>
        <AlertDescription>
          <p>{message}</p>
          <p>O link é pessoal e vale uma vez só: mande só para a pessoa convidada.</p>
        </AlertDescription>
      </Alert>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={inputRef}
          readOnly
          value={link}
          aria-label="Link do convite"
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" variant="outline" onClick={copy} className="shrink-0">
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copiado" : "Copiar link"}
        </Button>
      </div>
    </div>
  )
}
