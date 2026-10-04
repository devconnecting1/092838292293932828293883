"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { useForm } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { changePassword } from "@/app/(app)/perfil/actions"
import { FormTextField } from "@/components/configuracoes/form-fields"
import { changePasswordSchema, type ChangePasswordValues } from "@/lib/configuracoes/schemas"

const EMPTY_VALUES: ChangePasswordValues = {
  currentPassword: "",
  password: "",
  confirmPassword: "",
}

export function PasswordForm() {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY_VALUES,
  })

  function onSubmit(values: ChangePasswordValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await changePassword(values)

      if (result.ok) {
        toast.add({
          title: result.message ?? "Senha alterada.",
          type: "success",
        })
        form.reset(EMPTY_VALUES)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof ChangePasswordValues, {
            type: "server",
            message,
          })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível alterar a senha</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <FormTextField
          control={form.control}
          name="currentPassword"
          id="senha-atual"
          label="Senha atual"
          type="password"
          autoComplete="current-password"
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <FormTextField
            control={form.control}
            name="password"
            id="senha-nova"
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            description="Use pelo menos 8 caracteres."
          />
          <FormTextField
            control={form.control}
            name="confirmPassword"
            id="senha-confirmacao"
            label="Repita a nova senha"
            type="password"
            autoComplete="new-password"
          />
        </div>

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Alterar senha
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
