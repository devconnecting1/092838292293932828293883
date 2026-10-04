"use client"

import * as React from "react"
import { SendIcon, XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import {
  resendTeamInvitationAction,
  revokeTeamInvitationAction,
} from "@/app/plataforma/equipe/actions"
import { ManualInvitationLink } from "@/components/plataforma/equipe/manual-invitation-link"
import { ConfirmAction } from "@/components/plataforma/equipe/member-actions"

/** Reenviar (novo link, mais 7 dias) e revogar um convite aberto. Só o Dono vê. */
export function InvitationActions({
  invitationId,
  email,
}: {
  invitationId: string
  email: string
}) {
  const [isResending, startResend] = React.useTransition()
  const [manual, setManual] = React.useState<{ message: string; link: string } | null>(null)

  function resend() {
    startResend(async () => {
      const result = await resendTeamInvitationAction(invitationId)

      if (!result.ok) {
        toast.add({ title: "Não foi possível reenviar", description: result.error, type: "error" })
        return
      }

      if (result.manualLink) {
        setManual({ message: result.message, link: result.manualLink })
        return
      }

      toast.add({ title: result.message, type: "success" })
    })
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <Button
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        disabled={isResending}
        onClick={resend}
      >
        {isResending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
        Reenviar
      </Button>
      <ConfirmAction
        destructive
        triggerLabel="Revogar"
        triggerIcon={<XIcon data-icon="inline-start" />}
        title={`Revogar o convite de ${email}?`}
        description="O link para de valer na hora. Se mudar de ideia, é só convidar de novo."
        confirmLabel="Revogar convite"
        run={() => revokeTeamInvitationAction(invitationId)}
      />
      <Dialog
        open={manual !== null}
        onOpenChange={(open) => {
          if (!open) setManual(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Convite reenviado</DialogTitle>
            <DialogDescription>
              O link anterior parou de valer. Use o novo link abaixo.
            </DialogDescription>
          </DialogHeader>
          {manual ? <ManualInvitationLink message={manual.message} link={manual.link} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>Concluir</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
