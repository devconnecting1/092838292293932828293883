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
import { signUp } from "@/app/(auth)/actions"
import { FormFeedback, type FormFeedbackState } from "@/components/crm/form-feedback"
import { validateEmail, validateFullName, validateNewPassword } from "@/lib/auth/form-rules"
import { appendNextParam, LOGIN_PATH } from "@/lib/auth/routes"
import type { SignUpValues } from "@/lib/auth/schemas"

export function SignUpForm({ next }: { next: string | null }) {
  const [isPending, startTransition] = React.useTransition()
  const [feedback, setFeedback] = React.useState<FormFeedbackState>(null)
  const [confirmationMessage, setConfirmationMessage] = React.useState<string | null>(null)

  const form = useForm<SignUpValues>({
    defaultValues: { fullName: "", email: "", password: "" },
  })

  const loginHref = appendNextParam(LOGIN_PATH, next)

  function onSubmit(values: SignUpValues) {
    setFeedback(null)

    startTransition(async () => {
      const result = await signUp(values, next)

      if (!result) {
        return
      }

      if (result.ok) {
        setConfirmationMessage(result.message ?? "Confira sua caixa de entrada.")
      } else {
        setFeedback({ type: "error", message: result.error })
      }
    })
  }

  if (confirmationMessage) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Confirme seu e-mail" description={confirmationMessage} />
        <Button variant="outline" render={<Link href={loginHref} />} nativeButton={false}>
          Voltar para entrar
        </Button>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <AuthHeading
          title="Crie sua conta"
          description="Leva menos de um minuto. Depois você cadastra sua imobiliária."
        />
        <FormFeedback feedback={feedback} />
        <Controller
          name="fullName"
          control={form.control}
          rules={{ validate: validateFullName }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="cadastro-nome">Nome completo</FieldLabel>
              <Input
                {...field}
                id="cadastro-nome"
                autoComplete="name"
                placeholder="Maria da Silva"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Controller
          name="email"
          control={form.control}
          rules={{ validate: validateEmail }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="cadastro-email">E-mail</FieldLabel>
              <Input
                {...field}
                id="cadastro-email"
                type="email"
                autoComplete="email"
                placeholder="voce@imobiliaria.com.br"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>Enviaremos um link para confirmar o endereço.</FieldDescription>
              )}
            </Field>
          )}
        />
        <Controller
          name="password"
          control={form.control}
          rules={{ validate: validateNewPassword }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="cadastro-senha">Senha</FieldLabel>
              <Input
                {...field}
                id="cadastro-senha"
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
        <Field>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Criar conta
          </Button>
          <FieldDescription className="text-center">
            Já tem conta? <Link href={loginHref}>Entrar</Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
