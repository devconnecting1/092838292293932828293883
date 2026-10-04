import type { Metadata } from "next"

import { LoginForm } from "@/app/(auth)/entrar/login-form"
import type { FormFeedbackState } from "@/components/crm/form-feedback"
import { getAuthQueryErrorMessage, getAuthQueryNotice } from "@/lib/auth/errors"

export const metadata: Metadata = {
  title: "Entrar",
}

type EntrarPageProps = {
  searchParams: Promise<{
    next?: string | string[]
    erro?: string | string[]
    aviso?: string | string[]
  }>
}

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null
}

export default async function EntrarPage({ searchParams }: EntrarPageProps) {
  const params = await searchParams
  const errorMessage = getAuthQueryErrorMessage(readParam(params.erro))
  const notice = getAuthQueryNotice(readParam(params.aviso))

  const initialFeedback: FormFeedbackState = errorMessage
    ? { type: "error", message: errorMessage }
    : notice
      ? { type: "success", title: notice.title, message: notice.message }
      : null

  return <LoginForm next={readParam(params.next)} initialFeedback={initialFeedback} />
}
