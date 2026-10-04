"use client"

import * as React from "react"
import { CircleAlertIcon, UserPlusIcon } from "lucide-react"

import {
  PLATFORM_ROLE_DESCRIPTIONS,
  PLATFORM_ROLE_LABELS,
  PLATFORM_STAFF_ROLES,
  PLATFORM_TEAM_INVITATION_VALIDITY_DAYS,
  type PlatformStaffRole,
} from "@workspace/core/platform/staff"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { inviteTeamMemberAction } from "@/app/plataforma/equipe/actions"
import { ManualInvitationLink } from "@/components/plataforma/equipe/manual-invitation-link"

type InviteMemberDialogProps = {
  /** Motivo para não deixar convidar agora (trava de convites ou de envios). */
  blockedReason: string | null
}

/** Convite por e-mail (só o Dono vê este botão; o servidor confere de novo). */
export function InviteMemberDialog({ blockedReason }: InviteMemberDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={<Button className="w-full sm:w-auto" disabled={blockedReason !== null} />}
        >
          <UserPlusIcon data-icon="inline-start" />
          Convidar pessoa
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          {/* Monta a cada abertura: começa vazio. */}
          {open ? <InviteMemberForm onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
      {blockedReason ? (
        <p className="text-xs text-muted-foreground sm:max-w-xs sm:text-end">{blockedReason}</p>
      ) : null}
    </div>
  )
}

type FieldErrors = Partial<Record<"email" | "role", string>>

function InviteMemberForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<PlatformStaffRole>("viewer")
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [manual, setManual] = React.useState<{ message: string; link: string } | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    if (!email.trim()) {
      setFieldErrors({ email: "Informe o e-mail da pessoa." })
      return
    }

    setFieldErrors({})

    startTransition(async () => {
      const result = await inviteTeamMemberAction({ email, role })

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        setFormError(result.fieldErrors ? null : result.error)
        return
      }

      if (result.manualLink) {
        setManual({ message: result.message, link: result.manualLink })
        return
      }

      toast.add({ title: result.message, type: "success" })
      onDone()
    })
  }

  if (manual) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Convite criado</DialogTitle>
          <DialogDescription>
            A pessoa precisa entrar (ou criar a conta) com o e-mail convidado e clicar em Aceitar.
          </DialogDescription>
        </DialogHeader>
        <ManualInvitationLink message={manual.message} link={manual.link} />
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Concluir</DialogClose>
        </DialogFooter>
      </>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>Convidar para a equipe da plataforma</DialogTitle>
        <DialogDescription>
          Enviamos um link por e-mail que vale {PLATFORM_TEAM_INVITATION_VALIDITY_DAYS} dias e uma
          vez só. O acesso só começa quando a pessoa entra com este e-mail confirmado e aceita.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível convidar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Field data-invalid={Boolean(fieldErrors.email)}>
          <FieldLabel htmlFor="equipe-convite-email">E-mail</FieldLabel>
          <Input
            id="equipe-convite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            placeholder="nome@empresa.com.br"
            value={email}
            disabled={isPending}
            aria-invalid={Boolean(fieldErrors.email)}
            onChange={(event) => {
              setEmail(event.target.value)
              setFieldErrors((current) => ({ ...current, email: undefined }))
            }}
          />
          {fieldErrors.email ? (
            <FieldError>{fieldErrors.email}</FieldError>
          ) : (
            <FieldDescription>
              Confira com cuidado: só quem entrar com exatamente este e-mail consegue aceitar.
            </FieldDescription>
          )}
        </Field>

        <FieldSet data-invalid={Boolean(fieldErrors.role)}>
          <FieldLegend variant="label">Papel</FieldLegend>
          <RadioGroup
            value={role}
            onValueChange={(value) => {
              if (value === "admin" || value === "viewer") setRole(value)
            }}
            disabled={isPending}
          >
            {PLATFORM_STAFF_ROLES.map((option) => {
              const id = `equipe-convite-papel-${option}`

              return (
                <FieldLabel key={option} htmlFor={id}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{PLATFORM_ROLE_LABELS[option]}</FieldTitle>
                      <FieldDescription>{PLATFORM_ROLE_DESCRIPTIONS[option]}</FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value={option} id={id} />
                  </Field>
                </FieldLabel>
              )
            })}
          </RadioGroup>
          {fieldErrors.role ? <FieldError>{fieldErrors.role}</FieldError> : null}
        </FieldSet>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />} disabled={isPending}>
          Cancelar
        </DialogClose>
        <Button type="submit" disabled={isPending}>
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          Enviar convite
        </Button>
      </DialogFooter>
    </form>
  )
}
