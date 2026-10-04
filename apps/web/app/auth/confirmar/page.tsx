import type { EmailOtpType } from "@supabase/supabase-js"
import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { AuthHeading } from "@/app/(auth)/_components/auth-heading"
import { AuthShell } from "@/app/(auth)/_components/auth-shell"
import { ConfirmLinkForm } from "@/app/auth/confirmar/confirm-link-form"
import { APP_NAME } from "@/components/crm/brand"
import { defaultNextForEmailOtp, isEmailOtpType, isTokenHash } from "@/lib/auth/email-otp"
import { LOGIN_PATH, sanitizeRedirectPath } from "@/lib/auth/routes"

export const metadata: Metadata = {
  title: { absolute: `Confirmar acesso · ${APP_NAME}` },
  robots: { index: false, follow: false },
}

function getCopy(type: EmailOtpType) {
  switch (type) {
    case "recovery":
      return {
        title: "Criar nova senha",
        description: "Continue para confirmar o link de recuperação e definir uma nova senha.",
      }
    case "signup":
      return {
        title: "Confirme seu e-mail",
        description: "Continue para confirmar seu e-mail e ativar sua conta.",
      }
    case "invite":
      return {
        title: "Aceite o convite",
        description: "Continue para confirmar seu e-mail e ativar seu acesso.",
      }
    case "email_change":
      return {
        title: "Confirme o novo e-mail",
        description: "Continue para confirmar a troca do e-mail da sua conta.",
      }
    default:
      return {
        title: "Entre na sua conta",
        description: "Continue para entrar com o link que enviamos por e-mail.",
      }
  }
}

type ConfirmarPageProps = {
  searchParams: Promise<{
    token_hash?: string | string[]
    type?: string | string[]
    next?: string | string[]
  }>
}

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null
}

/**
 * Página intermediária de /auth/confirm: o token do e-mail só é consumido
 * quando a pessoa clica em "Continuar" (POST), nunca ao abrir o link.
 */
export default async function ConfirmarPage({ searchParams }: ConfirmarPageProps) {
  const params = await searchParams
  const tokenHash = readParam(params.token_hash)
  const type = readParam(params.type)

  if (!isTokenHash(tokenHash) || !isEmailOtpType(type)) {
    return (
      <AuthShell>
        <div className="flex flex-col gap-6">
          <AuthHeading
            title="Link inválido"
            description="Este link está incompleto ou já foi usado. Peça um novo para continuar."
          />
          <Button render={<Link href={LOGIN_PATH} />} nativeButton={false}>
            Voltar para o login
          </Button>
        </div>
      </AuthShell>
    )
  }

  const next = sanitizeRedirectPath(readParam(params.next), defaultNextForEmailOtp(type))
  const copy = getCopy(type)

  return (
    <AuthShell>
      <ConfirmLinkForm
        tokenHash={tokenHash}
        type={type}
        next={next}
        title={copy.title}
        description={copy.description}
      />
    </AuthShell>
  )
}
