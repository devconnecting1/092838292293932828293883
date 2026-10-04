"use client"

import * as React from "react"
import { ArrowLeftRightIcon, UserMinusIcon } from "lucide-react"

import { PLATFORM_ROLE_LABELS, type PlatformStaffRole } from "@workspace/core/platform/staff"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { changeTeamMemberRoleAction, removeTeamMemberAction } from "@/app/plataforma/equipe/actions"

type MemberActionsProps = {
  userId: string
  email: string
  role: PlatformStaffRole
}

/** Mudar o papel e remover, cada um com confirmação. Só o Dono vê. */
export function MemberActions({ userId, email, role }: MemberActionsProps) {
  const nextRole: PlatformStaffRole = role === "admin" ? "viewer" : "admin"

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <ConfirmAction
        triggerLabel={`Tornar ${PLATFORM_ROLE_LABELS[nextRole]}`}
        triggerIcon={<ArrowLeftRightIcon data-icon="inline-start" />}
        title={`Mudar ${email} para ${PLATFORM_ROLE_LABELS[nextRole]}?`}
        description={
          nextRole === "viewer"
            ? "A pessoa continua vendo todas as telas do console, mas deixa de executar ações. Vale a partir do próximo clique dela. Os Donos recebem um aviso por e-mail."
            : "A pessoa passa a usar todas as ações do console (bloquear imobiliária, prorrogar teste, comunicados, envio da Caixa, página de status), sem gerenciar a equipe. Os Donos recebem um aviso por e-mail."
        }
        confirmLabel={`Tornar ${PLATFORM_ROLE_LABELS[nextRole]}`}
        run={() => changeTeamMemberRoleAction(userId, nextRole)}
      />
      <ConfirmAction
        destructive
        triggerLabel="Remover"
        triggerIcon={<UserMinusIcon data-icon="inline-start" />}
        title={`Remover ${email} da equipe?`}
        description="O acesso ao Console da Plataforma acaba na hora (a conta continua existindo no CRM). Para voltar, só com um novo convite. Os Donos recebem um aviso por e-mail."
        confirmLabel="Remover da equipe"
        run={() => removeTeamMemberAction(userId)}
      />
    </div>
  )
}

type ConfirmActionProps = {
  triggerLabel: string
  triggerIcon: React.ReactNode
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  run: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>
}

export function ConfirmAction({
  triggerLabel,
  triggerIcon,
  title,
  description,
  confirmLabel,
  destructive = false,
  run,
}: ConfirmActionProps) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function confirm() {
    setError(null)

    startTransition(async () => {
      const result = await run()

      if (!result.ok) {
        setError(result.error)
        return
      }

      toast.add({ title: result.message, type: "success" })
      setOpen(false)
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setError(null)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant={destructive ? "destructive" : "outline"}
            size="sm"
            className="w-full sm:w-auto"
          />
        }
      >
        {triggerIcon}
        {triggerLabel}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={isPending}
            onClick={confirm}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
