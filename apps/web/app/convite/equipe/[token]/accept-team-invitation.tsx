"use client"

import * as React from "react"
import { CheckIcon, CircleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import {
  acceptTeamInvitationAction,
  type AcceptTeamInvitationResult,
} from "@/app/convite/equipe/[token]/actions"

/** Botão "Aceitar convite": o acesso só começa com este clique. */
export function AcceptTeamInvitation({ token }: { token: string }) {
  const [isPending, startTransition] = React.useTransition()
  const [failure, setFailure] = React.useState<AcceptTeamInvitationResult | null>(null)

  function onAccept() {
    setFailure(null)

    startTransition(async () => {
      // Em caso de sucesso a action redireciona para o console.
      const result = await acceptTeamInvitationAction(token)

      if (result && !result.ok) {
        setFailure(result)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {failure ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não foi possível aceitar o convite</AlertTitle>
          <AlertDescription>{failure.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button size="lg" onClick={onAccept} disabled={isPending}>
        {isPending ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
        Aceitar convite
      </Button>
    </div>
  )
}
