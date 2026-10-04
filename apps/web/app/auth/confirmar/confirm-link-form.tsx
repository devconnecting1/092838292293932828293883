"use client"

import type { EmailOtpType } from "@supabase/supabase-js"
import { useFormStatus } from "react-dom"

import { Button } from "@workspace/ui/components/button"
import { Field, FieldDescription, FieldGroup } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"

import { AuthHeading } from "@/app/(auth)/_components/auth-heading"
import { confirmEmailLink } from "@/app/auth/confirmar/actions"

function ContinueButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Continuar
    </Button>
  )
}

export function ConfirmLinkForm({
  tokenHash,
  type,
  next,
  title,
  description,
}: {
  tokenHash: string
  type: EmailOtpType
  next: string
  title: string
  description: string
}) {
  return (
    <form action={confirmEmailLink} className="flex flex-col gap-6">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      <FieldGroup>
        <AuthHeading title={title} description={description} />
        <Field>
          <ContinueButton />
          <FieldDescription className="text-center">
            Não pediu este link? Feche esta página; nada será alterado.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
