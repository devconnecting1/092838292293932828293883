"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, MailWarningIcon, UserPlusIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { APP_ROLE_LABELS, type AppRole } from "@workspace/core/properties/enums"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { createInvitation, type CreatedInvitation } from "@/app/(app)/configuracoes/equipe/actions"
import { CopyField } from "@/components/configuracoes/copy-field"
import { FormTextField } from "@/components/configuracoes/form-fields"
import { InvitationShareActions } from "@/components/configuracoes/invitation-share"
import { INVITATION_VALIDITY_DAYS } from "@/lib/configuracoes/invitations"
import { getRoleSelectItems, ROLE_DESCRIPTIONS } from "@/lib/configuracoes/roles"
import { invitationSchema, type InvitationValues } from "@/lib/configuracoes/schemas"
import { formatDateTime } from "@/lib/format"

export function InviteMemberDialog({
  assignableRoles,
  organizationName,
}: {
  assignableRoles: AppRole[]
  organizationName: string
}) {
  const defaultRole: AppRole = assignableRoles.includes("broker")
    ? "broker"
    : (assignableRoles[0] ?? "broker")
  const roleItems = getRoleSelectItems(assignableRoles)

  const [open, setOpen] = React.useState(false)
  const [created, setCreated] = React.useState<CreatedInvitation | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<InvitationValues>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { email: "", role: defaultRole },
  })
  const selectedRole = useWatch({ control: form.control, name: "role" })

  function startNewInvitation() {
    setCreated(null)
    setFormError(null)
    form.reset({ email: "", role: defaultRole })
  }

  function handleOpenChange(next: boolean) {
    if (isPending) return
    // Limpa ao abrir (e não ao fechar) para o conteúdo não mudar durante a animação.
    if (next) startNewInvitation()
    setOpen(next)
  }

  function onSubmit(values: InvitationValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await createInvitation(values)

      if (result.ok) {
        setCreated(result.invitation)
        toast.add({ title: result.message, type: "success" })
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof InvitationValues, {
            type: "server",
            message,
          })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <UserPlusIcon data-icon="inline-start" />
        Convidar pessoa
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Convite criado</DialogTitle>
              <DialogDescription>
                Envie o link para {created.email}. Ele vale até {formatDateTime(created.expiresAt)}{" "}
                e só funciona com este e-mail.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="convite-link">
                  Link do convite · {APP_ROLE_LABELS[created.role]}
                </FieldLabel>
                <CopyField id="convite-link" value={created.url} />
              </Field>
              <InvitationShareActions invitation={created} organizationName={organizationName} />
              <Alert>
                <MailWarningIcon />
                <AlertTitle>O CRM ainda não envia o convite sozinho</AlertTitle>
                <AlertDescription>
                  O envio automático por e-mail chega numa próxima versão. Por enquanto, mande o
                  link pelo WhatsApp ou pelo seu e-mail.
                </AlertDescription>
              </Alert>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" onClick={startNewInvitation}>
                Convidar outra pessoa
              </Button>
              <DialogClose render={<Button />}>Concluir</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Convidar para a equipe</DialogTitle>
              <DialogDescription>
                Geramos um link válido por {INVITATION_VALIDITY_DAYS} dias. A pessoa aceita entrando
                (ou criando a conta) com o e-mail informado.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
              <FieldGroup>
                {formError ? (
                  <Alert variant="destructive">
                    <CircleAlertIcon />
                    <AlertTitle>Não foi possível criar o convite</AlertTitle>
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                ) : null}
                <FormTextField
                  control={form.control}
                  name="email"
                  id="convite-email"
                  label="E-mail"
                  type="email"
                  autoComplete="off"
                  placeholder="nome@exemplo.com.br"
                />
                <Controller
                  name="role"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="convite-papel">Papel</FieldLabel>
                      <Select
                        items={roleItems}
                        value={field.value}
                        onValueChange={(value) => {
                          if (value) field.onChange(value)
                        }}
                        onOpenChange={(isOpen) => {
                          if (!isOpen) field.onBlur()
                        }}
                      >
                        <SelectTrigger
                          id="convite-papel"
                          className="w-full"
                          aria-invalid={fieldState.invalid}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {roleItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : (
                        <FieldDescription>{ROLE_DESCRIPTIONS[selectedRole]}</FieldDescription>
                      )}
                    </Field>
                  )}
                />
              </FieldGroup>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />} disabled={isPending}>
                  Cancelar
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Gerar convite
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
