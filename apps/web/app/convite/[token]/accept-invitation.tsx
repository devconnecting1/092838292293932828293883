"use client"

import * as React from "react"
import { CheckIcon, CircleAlertIcon, MailCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { acceptInvitation, type AcceptInvitationResult } from "@/app/convite/[token]/actions"

type AcceptFailure = Extract<AcceptInvitationResult, { ok: false }>

export function AcceptInvitation({ token }: { token: string }) {
  const [isPending, startTransition] = React.useTransition()
  const [failure, setFailure] = React.useState<AcceptFailure | null>(null)
  const needsEmailConfirmation = failure?.reason === "email_not_confirmed"

  function onAccept() {
    setFailure(null)

    startTransition(async () => {
      // Em caso de sucesso a action redireciona para o painel.
      const result = await acceptInvitation(token)

      if (result && !result.ok) {
        setFailure(result)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {needsEmailConfirmation ? (
        <Alert>
          <MailCheckIcon />
          <AlertTitle>Confirme seu e-mail</AlertTitle>
          <AlertDescription>{failure.error}</AlertDescription>
        </Alert>
      ) : failure ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não foi possível aceitar o convite</AlertTitle>
          <AlertDescription>{failure.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button size="lg" onClick={onAccept} disabled={isPending}>
        {isPending ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
        {needsEmailConfirmation ? "Já confirmei, aceitar convite" : "Aceitar convite"}
      </Button>
    </div>
  )
}
