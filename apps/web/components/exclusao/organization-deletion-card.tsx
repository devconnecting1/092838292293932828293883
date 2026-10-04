"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarClockIcon,
  CircleCheckIcon,
  DownloadIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { BillingPortalButton } from "@/components/billing/billing-portal-button"
import { TypedConfirmDialog } from "@/components/lixeira/typed-confirm-dialog"
import { cancelOrganizationDeletion, scheduleOrganizationDeletion } from "@/lib/exclusao/actions"
import {
  EXPORTS_PATH,
  formatDeletionDate,
  ORGANIZATION_DELETION_ANCHOR,
  ORGANIZATION_DELETION_DAYS,
  ORGANIZATION_DELETION_REMINDER_DAYS,
} from "@/lib/exclusao/constants"
import type { OrganizationDeletionStatus } from "@/lib/exclusao/queries"

type OrganizationDeletionCardProps = {
  organizationName: string
  slug: string
  /** null: não carregou (o banco continua conferindo tudo ao agendar). */
  status: OrganizationDeletionStatus | null
}

const WHAT_IS_DELETED =
  "clientes, leads, imóveis, fotos, documentos, propostas, comissões, agenda, tarefas, landing pages, a equipe e os acessos"

/** "Excluir a imobiliária" em Configurações > Imobiliária (só o dono vê). */
export function OrganizationDeletionCard({
  organizationName,
  slug,
  status,
}: OrganizationDeletionCardProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isCanceling, startCancel] = React.useTransition()
  const renewsHintId = React.useId()
  const subscriptionRenews = status?.subscriptionRenews ?? false

  function cancel() {
    startCancel(async () => {
      const result = await cancelOrganizationDeletion()

      if (!result.ok) {
        toast.add({ title: "Não foi possível cancelar", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Exclusão cancelada.", type: "success" })
      router.refresh()
    })
  }

  return (
    <Card id={ORGANIZATION_DELETION_ANCHOR} className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Excluir a imobiliária</CardTitle>
        <CardDescription>
          Apaga de vez todos os dados de {organizationName} depois de {ORGANIZATION_DELETION_DAYS}{" "}
          dias. Só o dono vê esta opção.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status?.scheduled && status.executeAfter ? (
          <>
            <Alert variant="destructive">
              <CalendarClockIcon />
              <AlertTitle>
                Exclusão agendada para {formatDeletionDate(status.executeAfter)}
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>
                  A conta está em modo leitura: a equipe vê e exporta tudo, mas não cria nem edita.
                  Nessa data apagamos {WHAT_IS_DELETED}. Até lá, dá para cancelar.
                </p>
                {status.requestedAt ? (
                  <p>
                    Pedido em {formatDeletionDate(status.requestedAt)}
                    {status.requestedByName ? ` por ${status.requestedByName}` : ""}.
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
            {subscriptionRenews ? (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>A assinatura voltou a renovar</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-2">
                  <p>
                    Enquanto a assinatura renovar, a exclusão não acontece. Cancele a assinatura
                    para seguir com a exclusão.
                  </p>
                  <BillingPortalButton flow="subscription_cancel">
                    Cancelar a assinatura
                  </BillingPortalButton>
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              variant="outline"
              className="self-start"
              disabled={isCanceling}
              onClick={cancel}
            >
              {isCanceling ? (
                <Spinner data-icon="inline-start" aria-label="Cancelando" />
              ) : (
                <Undo2Icon data-icon="inline-start" />
              )}
              Cancelar a exclusão
            </Button>
          </>
        ) : (
          <>
            <ol className="flex flex-col gap-4">
              <li className="flex flex-col gap-2">
                <h3 className="font-medium">1. Exporte o que precisar guardar</h3>
                <p className="text-sm text-muted-foreground">
                  Em Relatórios, escolha o período desde o início e baixe as planilhas de leads,
                  imóveis, clientes e propostas. Depois da exclusão, nada pode ser recuperado.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  render={<Link href={EXPORTS_PATH} />}
                  nativeButton={false}
                >
                  <DownloadIcon data-icon="inline-start" />
                  Abrir as exportações
                </Button>
              </li>
              <li className="flex flex-col gap-2">
                <h3 className="font-medium">2. Cancele a assinatura</h3>
                {subscriptionRenews ? (
                  <>
                    <p id={renewsHintId} className="text-sm text-muted-foreground">
                      A assinatura ainda renova. Cancele no portal de pagamento antes de agendar: a
                      cobrança para no fim do período já pago.
                    </p>
                    <BillingPortalButton flow="subscription_cancel">
                      Cancelar a assinatura
                    </BillingPortalButton>
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CircleCheckIcon className="size-4 shrink-0" aria-hidden="true" />
                    Não há cobrança que renove.
                  </p>
                )}
              </li>
              <li className="flex flex-col gap-2">
                <h3 className="font-medium">3. Agende a exclusão</h3>
                <p className="text-sm text-muted-foreground">
                  A conta fica em modo leitura por {ORGANIZATION_DELETION_DAYS} dias e você pode
                  cancelar até lá. Os donos recebem um e-mail agora e outro{" "}
                  {ORGANIZATION_DELETION_REMINDER_DAYS} dias antes. No fim do prazo apagamos{" "}
                  {WHAT_IS_DELETED}. As contas de login das pessoas continuam existindo, sem acesso
                  a esta imobiliária.
                </p>
                <Button
                  variant="destructive"
                  className="self-start"
                  disabled={subscriptionRenews}
                  aria-describedby={subscriptionRenews ? renewsHintId : undefined}
                  onClick={() => setOpen(true)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Excluir a imobiliária
                </Button>
              </li>
            </ol>
            <TypedConfirmDialog
              open={open}
              onOpenChange={setOpen}
              title="Excluir a imobiliária?"
              expected={slug}
              confirmLabel="Agendar a exclusão"
              action={scheduleOrganizationDeletion}
              onDone={() => router.refresh()}
            >
              <p>
                Em {ORGANIZATION_DELETION_DAYS} dias apagamos de vez {WHAT_IS_DELETED} de{" "}
                {organizationName}. Até lá a conta fica em modo leitura e você pode cancelar.
              </p>
              <p>Para confirmar, digite o link da imobiliária.</p>
            </TypedConfirmDialog>
          </>
        )}
      </CardContent>
    </Card>
  )
}
