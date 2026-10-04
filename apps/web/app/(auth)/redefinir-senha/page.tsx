import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { AuthHeading } from "@/app/(auth)/_components/auth-heading"
import { ResetPasswordForm } from "@/app/(auth)/redefinir-senha/reset-password-form"
import { signOut } from "@/lib/auth/actions"
import {
  getRecoverySessionState,
  RECOVERY_LINK_REQUIRED_MESSAGE,
} from "@/lib/auth/recovery-session"
import { RECOVER_PASSWORD_PATH } from "@/lib/auth/routes"

export const metadata: Metadata = {
  title: "Nova senha",
}

export default async function RedefinirSenhaPage() {
  // A sessão de recuperação é criada em /auth/callback (PKCE) ou em
  // /auth/confirmar (token_hash) e só vale por alguns minutos.
  const session = await getRecoverySessionState()

  if (session.status === "recovery") {
    return <ResetPasswordForm email={session.email} />
  }

  if (session.status === "signed-in") {
    // /recuperar-senha é só para visitantes; logado, a troca é no /perfil.
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading
          title="Use o link de recuperação"
          description={`${RECOVERY_LINK_REQUIRED_MESSAGE} Se você só quer trocar a senha, faça isso no seu perfil, confirmando a senha atual.`}
        />
        <div className="flex flex-col gap-3">
          <Button render={<Link href="/perfil" />} nativeButton={false}>
            Trocar senha no perfil
          </Button>
          <form action={signOut} className="flex flex-col">
            <Button type="submit" variant="outline">
              Esqueci a senha atual: sair da conta
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Link expirado"
        description={`${RECOVERY_LINK_REQUIRED_MESSAGE} Se ele expirou, peça outro.`}
      />
      <Button render={<Link href={RECOVER_PASSWORD_PATH} />} nativeButton={false}>
        Pedir novo link
      </Button>
    </div>
  )
}
