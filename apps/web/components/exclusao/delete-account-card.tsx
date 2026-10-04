"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldAlertIcon, UserRoundXIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { TypedConfirmDialog } from "@/components/lixeira/typed-confirm-dialog"
import { TEAM_SETTINGS_PATH } from "@/components/shared/settings-config"
import { deleteMyAccount } from "@/lib/exclusao/actions"
import { ORGANIZATION_DELETION_HREF } from "@/lib/exclusao/constants"
import type { AccountDeletionBlocker } from "@/lib/exclusao/queries"

type DeleteAccountCardProps = {
  email: string | null
  /** null: não carregou (o banco confere de novo ao excluir). */
  blockers: AccountDeletionBlocker[] | null
}

/** "Excluir minha conta" em Meu perfil. */
export function DeleteAccountCard({ email, blockers }: DeleteAccountCardProps) {
  const [open, setOpen] = React.useState(false)
  const blockerNames = (blockers ?? []).map((item) => item.organizationName)
  const blocked = blockerNames.length > 0 || !email

  const consequences = [
    "Você perde o acesso a todas as imobiliárias em que trabalha, e todos os aparelhos saem da conta.",
    'Apagamos nome, telefone, foto e CRECI do seu perfil, os avisos no celular e as preferências de e-mail. No histórico das imobiliárias, seu nome passa a aparecer como "Usuário removido".',
    "Leads, clientes, imóveis, visitas e anotações que você cadastrou pertencem à imobiliária e continuam com ela.",
    "O e-mail de acesso continua registrado só para o login: se entrar de novo, você começa sem acesso a nenhuma imobiliária. Para apagar também o e-mail de acesso, fale com o suporte.",
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Excluir minha conta</CardTitle>
        <CardDescription>
          Tira o seu acesso ao CRM e apaga os seus dados de perfil. Não pode ser desfeito.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-muted-foreground">
          {consequences.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        {blockerNames.length > 0 ? (
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>Antes, resolva a posse da imobiliária</AlertTitle>
            <AlertDescription>
              <p>
                Você é o único dono de {blockerNames.join(", ")}. Torne outra pessoa dona em{" "}
                <Link href={TEAM_SETTINGS_PATH}>Configurações &gt; Equipe</Link> ou{" "}
                <Link href={ORGANIZATION_DELETION_HREF}>exclua a imobiliária</Link>. Uma imobiliária
                agendada para exclusão também precisa esperar a data.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {!email ? (
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>Fale com o suporte</AlertTitle>
            <AlertDescription>
              Sua conta não tem e-mail de acesso para confirmar a exclusão por aqui.
            </AlertDescription>
          </Alert>
        ) : null}

        <Button
          variant="destructive"
          className="self-start"
          disabled={blocked}
          onClick={() => setOpen(true)}
        >
          <UserRoundXIcon data-icon="inline-start" />
          Excluir minha conta
        </Button>

        {email ? (
          <TypedConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Excluir a sua conta?"
            expected={email}
            confirmLabel="Excluir minha conta"
            action={deleteMyAccount}
          >
            <p>
              Você sai de todas as imobiliárias e de todos os aparelhos agora, e os seus dados de
              perfil são apagados. O que você cadastrou continua com as imobiliárias.
            </p>
            <p>Para confirmar, digite o seu e-mail de acesso.</p>
          </TypedConfirmDialog>
        ) : null}
      </CardContent>
    </Card>
  )
}
