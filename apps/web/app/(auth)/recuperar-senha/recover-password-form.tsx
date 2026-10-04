"use client"

import * as React from "react"
import Link from "next/link"
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
import { requestPasswordReset } from "@/app/(auth)/actions"
import { FormFeedback, type FormFeedbackState } from "@/components/crm/form-feedback"
import { validateEmail } from "@/lib/auth/form-rules"
import type { RecoverPasswordValues } from "@/lib/auth/schemas"

export function RecoverPasswordForm() {
  const [isPending, startTransition] = React.useTransition()
  const [feedback, setFeedback] = React.useState<FormFeedbackState>(null)

  const form = useForm<RecoverPasswordValues>({
    defaultValues: { email: "" },
  })

  function onSubmit(values: RecoverPasswordValues) {
    setFeedback(null)

    startTransition(async () => {
      const result = await requestPasswordReset(values)

      if (!result) {
        return
      }

      setFeedback(
        result.ok
          ? {
              type: "success",
              title: "Pedido recebido",
              message: result.message ?? "Confira sua caixa de entrada.",
            }
          : { type: "error", message: result.error }
      )
    })
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <AuthHeading
          title="Recuperar senha"
          description="Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha."
        />
        <FormFeedback feedback={feedback} />
        <Controller
          name="email"
          control={form.control}
          rules={{ validate: validateEmail }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="recuperar-email">E-mail</FieldLabel>
              <Input
                {...field}
                id="recuperar-email"
                type="email"
                autoComplete="email"
                placeholder="voce@imobiliaria.com.br"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Field>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Enviar link
          </Button>
          <FieldDescription className="text-center">
            Lembrou a senha? <Link href="/entrar">Voltar para entrar</Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
