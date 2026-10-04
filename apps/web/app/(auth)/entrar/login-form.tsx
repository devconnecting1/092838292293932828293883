"use client"

import * as React from "react"
import Link from "next/link"
import { MailIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

import { AuthHeading } from "@/app/(auth)/_components/auth-heading"
import { sendMagicLink, signInWithPassword } from "@/app/(auth)/actions"
import { FormFeedback, type FormFeedbackState } from "@/components/crm/form-feedback"
import { validateCurrentPassword, validateEmail } from "@/lib/auth/form-rules"
import { appendNextParam, SIGN_UP_PATH } from "@/lib/auth/routes"
import type { SignInValues } from "@/lib/auth/schemas"

type PendingAction = "password" | "magic-link" | null

export function LoginForm({
  next,
  initialFeedback,
}: {
  next: string | null
  initialFeedback: FormFeedbackState
}) {
  const [isPending, startTransition] = React.useTransition()
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null)
  const [feedback, setFeedback] = React.useState<FormFeedbackState>(initialFeedback)

  const form = useForm<SignInValues>({
    defaultValues: { email: "", password: "" },
  })

  function onSubmit(values: SignInValues) {
    setFeedback(null)
    setPendingAction("password")

    startTransition(async () => {
      const result = await signInWithPassword(values, next)

      if (result && !result.ok) {
        setFeedback({ type: "error", message: result.error })
      }

      setPendingAction(null)
    })
  }

  async function onMagicLink() {
    form.clearErrors("password")
    const isEmailValid = await form.trigger("email")

    if (!isEmailValid) {
      return
    }

    setFeedback(null)
    setPendingAction("magic-link")

    startTransition(async () => {
      const result = await sendMagicLink({ email: form.getValues("email") }, next)

      if (result) {
        setFeedback(
          result.ok
            ? {
                type: "success",
                title: "Link enviado",
                message: result.message ?? "Confira sua caixa de entrada.",
              }
            : { type: "error", message: result.error }
        )
      }

      setPendingAction(null)
    })
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <AuthHeading
          title="Entre na sua conta"
          description="Use seu e-mail e senha ou receba um link de acesso."
        />
        <FormFeedback feedback={feedback} />
        <Controller
          name="email"
          control={form.control}
          rules={{ validate: validateEmail }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="entrar-email">E-mail</FieldLabel>
              <Input
                {...field}
                id="entrar-email"
                type="email"
                autoComplete="email"
                placeholder="voce@imobiliaria.com.br"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Controller
          name="password"
          control={form.control}
          rules={{ validate: validateCurrentPassword }}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <div className="flex items-center">
                <FieldLabel htmlFor="entrar-senha">Senha</FieldLabel>
                <Link
                  href="/recuperar-senha"
                  className="ms-auto text-sm underline-offset-4 hover:underline"
                >
                  Esqueceu a senha?
                </Link>
              </div>
              <Input
                {...field}
                id="entrar-senha"
                type="password"
                autoComplete="current-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Field>
          <Button type="submit" disabled={isPending}>
            {pendingAction === "password" ? <Spinner data-icon="inline-start" /> : null}
            Entrar
          </Button>
        </Field>
        <FieldSeparator>ou</FieldSeparator>
        <Field>
          <Button type="button" variant="outline" onClick={onMagicLink} disabled={isPending}>
            {pendingAction === "magic-link" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <MailIcon data-icon="inline-start" />
            )}
            Receber link de acesso
          </Button>
          <FieldDescription className="text-center">
            Ainda não tem conta? <Link href={appendNextParam(SIGN_UP_PATH, next)}>Criar conta</Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
