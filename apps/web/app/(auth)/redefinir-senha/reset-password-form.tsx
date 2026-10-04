"use client"

import * as React from "react"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

import { AuthHeading } from "@/app/(auth)/_components/auth-heading"
import { updatePassword } from "@/app/(auth)/actions"
import { FormFeedback, type FormFeedbackState } from "@/components/crm/form-feedback"
import { validateConfirmPassword, validateNewPassword } from "@/lib/auth/form-rules"
import type { ResetPasswordValues } from "@/lib/auth/schemas"

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [isPending, startTransition] = React.useTransition()
  const [feedback, setFeedback] = React.useState<FormFeedbackState>(null)

  const form = useForm<ResetPasswordValues>({
    defaultValues: { password: "", confirmPassword: "" },
  })

  function onSubmit(values: ResetPasswordValues) {
    setFeedback(null)

    startTransition(async () => {
      const result = await updatePassword(values)

      if (result && !result.ok) {
        setFeedback({ type: "error", message: result.error })
      }
    })
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <AuthHeading
          title="Crie uma nova senha"
          description={
            email ? `Defina a nova senha da conta ${email}.` : "Defina a nova senha da sua conta."
          }
        />
        <FormFeedback feedback={feedback} />
        <Controller
          name="password"
          control={form.control}
          rules={{ validate: validateNewPassword }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="nova-senha">Nova senha</FieldLabel>
              <Input
                {...field}
                id="nova-senha"
                type="password"
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>Use pelo menos 8 caracteres.</FieldDescription>
              )}
            </Field>
          )}
        />
        <Controller
          name="confirmPassword"
          control={form.control}
          rules={{ validate: validateConfirmPassword }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="confirmar-senha">Repita a nova senha</FieldLabel>
              <Input
                {...field}
                id="confirmar-senha"
                type="password"
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Field>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar nova senha
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
