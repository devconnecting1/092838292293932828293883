import type { Metadata } from "next"
import Link from "next/link"
import { CircleAlertIcon, InfoIcon, LinkIcon, LogInIcon, UserPlusIcon } from "lucide-react"

import { APP_ROLE_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { AcceptInvitation } from "@/app/convite/[token]/accept-invitation"
import { switchAccount } from "@/app/convite/[token]/actions"
import { APP_NAME, BrandLogo } from "@/components/crm/brand"
import { LOGIN_PATH, SIGN_UP_PATH } from "@/lib/auth/routes"
import { getCurrentUser } from "@/lib/auth/session"
import {
  buildInvitationPath,
  isInvitationToken,
  parseInvitationPreview,
} from "@/lib/configuracoes/invitations"
import { formatDate } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Convite para a equipe",
}

type ConvitePageProps = {
  params: Promise<{ token: string }>
}

function withNext(path: string, next: string) {
  return `${path}?${new URLSearchParams({ next }).toString()}`
}

/**
 * Página pública do convite. A prévia (get_invitation_preview) é pública e não
 * exige sessão: mostra a imobiliária, o papel e uma dica do e-mail convidado
 * antes do aceite. O aceite em si continua exigindo sessão e valida token,
 * validade e e-mail no banco (accept_invitation).
 */
export default async function ConvitePage({ params }: ConvitePageProps) {
  const { token } = await params
  const isValidToken = isInvitationToken(token)

  let preview = null
  if (isValidToken) {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("get_invitation_preview", {
      p_token: token,
    })

    if (error) {
      // Só o código: nada de token no log.
      console.error(`[convite] get_invitation_preview falhou: ${error.code ?? "erro"}`)
    } else {
      preview = parseInvitationPreview(data)
    }
  }

  const user = isValidToken && preview ? await getCurrentUser() : null
  const invitationPath = buildInvitationPath(token)

  return (
    <>
      <header className="flex items-center justify-between gap-4 p-4 md:px-10 md:py-6">
        <BrandLogo />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-10 md:items-center">
        <Card className="w-full max-w-lg">
          {!isValidToken ? (
            <>
              <CardHeader>
                <CardTitle>Link de convite inválido</CardTitle>
                <CardDescription>
                  O endereço está incompleto ou foi alterado. Copie o link inteiro da mensagem que
                  você recebeu ou peça um novo a quem convidou você.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button variant="outline" render={<Link href={LOGIN_PATH} />} nativeButton={false}>
                  Ir para o login
                </Button>
              </CardFooter>
            </>
          ) : !preview ? (
            <>
              <CardHeader>
                <CardTitle>Convite não encontrado</CardTitle>
                <CardDescription>
                  Este link não corresponde a nenhum convite. Confira se copiou o endereço completo
                  ou peça um novo link a quem convidou você.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button variant="outline" render={<Link href={LOGIN_PATH} />} nativeButton={false}>
                  Ir para o login
                </Button>
              </CardFooter>
            </>
          ) : preview.accepted ? (
            <>
              <CardHeader>
                <CardTitle>Convite já utilizado</CardTitle>
                <CardDescription>
                  O convite para {preview.organizationName} já foi aceito. Entre com a conta que
                  você já usa para acessar a imobiliária.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button render={<Link href={LOGIN_PATH} />} nativeButton={false}>
                  Ir para o login
                </Button>
              </CardFooter>
            </>
          ) : preview.expired ? (
            <>
              <CardHeader>
                <CardTitle>Convite expirado</CardTitle>
                <CardDescription>
                  O convite para {preview.organizationName} venceu em{" "}
                  {formatDate(preview.expiresAt)}. Peça a quem convidou você para enviar um novo
                  link.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Convite para {preview.emailHint}</AlertTitle>
                  <AlertDescription>Este link não vale mais.</AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter>
                <Button variant="outline" render={<Link href={LOGIN_PATH} />} nativeButton={false}>
                  Ir para o login
                </Button>
              </CardFooter>
            </>
          ) : !user ? (
            <>
              <CardHeader>
                <CardTitle>Você recebeu um convite</CardTitle>
                <CardDescription>
                  Você foi convidado para {preview.organizationName} como{" "}
                  {APP_ROLE_LABELS[preview.role]} no {APP_NAME}. Para aceitar, entre ou crie sua
                  conta com o mesmo e-mail que recebeu o convite.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Alert>
                  <InfoIcon />
                  <AlertTitle>Convite para {preview.emailHint}</AlertTitle>
                  <AlertDescription>
                    Vale até {formatDate(preview.expiresAt)}. Depois de confirmar seu e-mail, volte
                    a este link para concluir o aceite.
                  </AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="w-full sm:flex-1"
                  render={<Link href={withNext(SIGN_UP_PATH, invitationPath)} />}
                  nativeButton={false}
                >
                  <UserPlusIcon data-icon="inline-start" />
                  Criar conta
                </Button>
                <Button
                  variant="outline"
                  className="w-full sm:flex-1"
                  render={<Link href={withNext(LOGIN_PATH, invitationPath)} />}
                  nativeButton={false}
                >
                  <LogInIcon data-icon="inline-start" />
                  Entrar
                </Button>
              </CardFooter>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Aceitar convite</CardTitle>
                <CardDescription>
                  {user.email ? `Você entrou como ${user.email}. ` : ""}
                  Você foi convidado para {preview.organizationName} como{" "}
                  {APP_ROLE_LABELS[preview.role]}. Ao aceitar, a imobiliária aparece no seu menu com
                  esse papel.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Convite para {preview.emailHint} · vale até {formatDate(preview.expiresAt)}.
                </p>
                <AcceptInvitation token={token} />
              </CardContent>
              <CardFooter className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LinkIcon className="size-4" />O convite só vale para o e-mail convidado.
                </p>
                <form action={switchAccount.bind(null, token)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Entrar com outra conta
                  </Button>
                </form>
              </CardFooter>
            </>
          )}
        </Card>
      </main>
    </>
  )
}
