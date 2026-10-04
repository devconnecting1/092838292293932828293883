import type { Metadata } from "next"
import Link from "next/link"
import { InfoIcon, LogInIcon, MailCheckIcon, ShieldCheckIcon, UserPlusIcon } from "lucide-react"

import { isPlatformAdminEmail } from "@workspace/core/caixa/platform-admins"
import {
  buildPlatformTeamInvitationPath,
  isPlatformTeamInvitationToken,
  PLATFORM_ROLE_DESCRIPTIONS,
  PLATFORM_ROLE_LABELS,
  type PlatformTeamInvitationPreview,
} from "@workspace/core/platform/staff"
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

import { AcceptTeamInvitation } from "@/app/convite/equipe/[token]/accept-team-invitation"
import { switchAccountForTeamInvitation } from "@/app/convite/equipe/[token]/actions"
import { APP_NAME, BrandLogo } from "@/components/crm/brand"
import { LOGIN_PATH, PLATFORM_ADMIN_PATH_PREFIX, SIGN_UP_PATH } from "@/lib/auth/routes"
import { getCurrentUser } from "@/lib/auth/session"
import { formatDate } from "@/lib/format"
import { previewPlatformTeamInvitation } from "@/lib/plataforma/equipe"

export const metadata: Metadata = {
  title: "Convite para a equipe da plataforma",
}

type PageProps = {
  params: Promise<{ token: string }>
}

function withNext(path: string, next: string) {
  return `${path}?${new URLSearchParams({ next }).toString()}`
}

function MessageCard({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: { label: string; href: string }
}) {
  return (
    <>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          render={<Link href={action?.href ?? LOGIN_PATH} />}
          nativeButton={false}
        >
          {action?.label ?? "Ir para o login"}
        </Button>
      </CardFooter>
    </>
  )
}

function RoleSummary({ preview }: { preview: PlatformTeamInvitationPreview }) {
  return (
    <Alert>
      <ShieldCheckIcon />
      <AlertTitle>Papel: {PLATFORM_ROLE_LABELS[preview.role]}</AlertTitle>
      <AlertDescription>
        <p>{PLATFORM_ROLE_DESCRIPTIONS[preview.role]}</p>
        <p>Convite válido até {formatDate(preview.expiresAt)}.</p>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Convite para a equipe do Console da Plataforma. Fica fora do layout do
 * console (que dá 404 para quem ainda não é da equipe) e sob /convite (pública
 * no proxy, atendida no domínio raiz, `next` aceito no login e no cadastro).
 *
 * A prévia só diz a situação, o papel e a validade: nunca o e-mail convidado.
 * Sem login, oferece entrar ou criar conta voltando para cá. Logado, só aceita
 * com o e-mail da conta igual ao convidado e confirmado, e só com o clique em
 * "Aceitar convite" (a action e o banco conferem tudo de novo).
 */
export default async function PlatformTeamInvitationPage({ params }: PageProps) {
  const { token } = await params

  if (!isPlatformTeamInvitationToken(token)) {
    return (
      <Shell>
        <MessageCard
          title="Link de convite inválido"
          description="O endereço está incompleto ou foi alterado. Copie o link inteiro do e-mail que você recebeu ou peça um novo convite ao Dono da plataforma."
        />
      </Shell>
    )
  }

  const user = await getCurrentUser()
  const result = await previewPlatformTeamInvitation(token, user?.id ?? null)
  const invitationPath = buildPlatformTeamInvitationPath(token)

  if (!result.ok) {
    return (
      <Shell>
        <MessageCard
          title="Não foi possível abrir o convite agora"
          description="Tente de novo em instantes. Se continuar, avise o Dono da plataforma."
          action={{ label: "Tentar de novo", href: invitationPath }}
        />
      </Shell>
    )
  }

  const { preview } = result

  if (!preview) {
    return (
      <Shell>
        <MessageCard
          title="Convite não encontrado"
          description="Este link não corresponde a nenhum convite. Se o convite foi reenviado, só o link do e-mail mais recente vale."
        />
      </Shell>
    )
  }

  if (preview.status === "usado") {
    return (
      <Shell>
        <MessageCard
          title="Convite já utilizado"
          description={
            preview.alreadyMember
              ? "Você já faz parte da equipe da plataforma."
              : "Este convite já foi aceito. Entre com a conta que aceitou o convite."
          }
          action={
            preview.alreadyMember
              ? { label: "Abrir o Console da Plataforma", href: PLATFORM_ADMIN_PATH_PREFIX }
              : undefined
          }
        />
      </Shell>
    )
  }

  if (preview.status === "revogado") {
    return (
      <Shell>
        <MessageCard
          title="Convite cancelado"
          description="Este convite foi revogado. Se ainda precisa de acesso, peça um novo convite ao Dono da plataforma."
        />
      </Shell>
    )
  }

  if (preview.status === "expirado") {
    return (
      <Shell>
        <MessageCard
          title="Convite expirado"
          description={`Este convite venceu em ${formatDate(preview.expiresAt)}. Peça ao Dono da plataforma para reenviar.`}
        />
      </Shell>
    )
  }

  if (!user) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle>Você foi convidado para a equipe da plataforma</CardTitle>
          <CardDescription>
            Convite para a equipe do Console da Plataforma do {APP_NAME} como{" "}
            {PLATFORM_ROLE_LABELS[preview.role]}. Para aceitar, entre ou crie sua conta com o mesmo
            e-mail que recebeu o convite.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RoleSummary preview={preview} />
          <p className="text-sm text-muted-foreground">
            Conta nova? Depois de confirmar o e-mail pelo link que enviamos, você volta para este
            convite.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="w-full sm:flex-1"
            render={<Link href={withNext(LOGIN_PATH, invitationPath)} />}
            nativeButton={false}
          >
            <LogInIcon data-icon="inline-start" />
            Entrar
          </Button>
          <Button
            variant="outline"
            className="w-full sm:flex-1"
            render={<Link href={withNext(SIGN_UP_PATH, invitationPath)} />}
            nativeButton={false}
          >
            <UserPlusIcon data-icon="inline-start" />
            Criar conta
          </Button>
        </CardFooter>
      </Shell>
    )
  }

  const switchAccount = (
    <form action={switchAccountForTeamInvitation.bind(null, token)}>
      <Button type="submit" variant="outline" className="w-full sm:w-auto">
        Sair e entrar com outro e-mail
      </Button>
    </form>
  )

  if (isPlatformAdminEmail(user.email, process.env.PLATFORM_ADMIN_EMAILS)) {
    return (
      <Shell>
        <MessageCard
          title="Você já é Dono da plataforma"
          description="Sua conta já tem acesso total pela configuração do servidor e não precisa deste convite."
          action={{ label: "Abrir o Console da Plataforma", href: PLATFORM_ADMIN_PATH_PREFIX }}
        />
      </Shell>
    )
  }

  if (preview.alreadyMember) {
    return (
      <Shell>
        <MessageCard
          title="Você já faz parte da equipe"
          description="Sua conta já tem acesso ao Console da Plataforma. Para mudar o papel, fale com o Dono da plataforma."
          action={{ label: "Abrir o Console da Plataforma", href: PLATFORM_ADMIN_PATH_PREFIX }}
        />
      </Shell>
    )
  }

  if (!preview.emailMatches) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle>Este convite é para outro e-mail</CardTitle>
          <CardDescription>
            Você entrou como {user.email ?? "uma conta sem e-mail"}, mas o convite foi enviado para
            outro endereço. Saia e entre (ou crie a conta) com o e-mail que recebeu o convite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <InfoIcon />
            <AlertTitle>Por que não dá para aceitar com esta conta?</AlertTitle>
            <AlertDescription>
              O acesso ao console só vale para o e-mail convidado, para que um endereço digitado
              errado não dê acesso a outra pessoa.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>{switchAccount}</CardFooter>
      </Shell>
    )
  }

  if (!preview.emailConfirmed) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle>Confirme seu e-mail</CardTitle>
          <CardDescription>
            Abra o link de confirmação que enviamos para {user.email} e depois volte a este convite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <MailCheckIcon />
            <AlertTitle>O aceite exige e-mail confirmado</AlertTitle>
            <AlertDescription>Assim temos certeza de que o endereço é seu.</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            render={<Link href={invitationPath} />}
            nativeButton={false}
          >
            Já confirmei
          </Button>
        </CardFooter>
      </Shell>
    )
  }

  return (
    <Shell>
      <CardHeader>
        <CardTitle>Aceitar o convite</CardTitle>
        <CardDescription>
          Você entrou como {user.email}. Ao aceitar, sua conta passa a acessar o Console da
          Plataforma do {APP_NAME} como {PLATFORM_ROLE_LABELS[preview.role]}. Os Donos da plataforma
          recebem um aviso.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RoleSummary preview={preview} />
        <AcceptTeamInvitation token={token} />
      </CardContent>
      <CardFooter>{switchAccount}</CardFooter>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="flex items-center justify-between gap-4 p-4 md:px-10 md:py-6">
        <BrandLogo />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-10 md:items-center">
        <Card className="w-full max-w-lg">{children}</Card>
      </main>
    </>
  )
}
