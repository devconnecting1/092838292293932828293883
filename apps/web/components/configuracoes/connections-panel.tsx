"use client"

import * as React from "react"
import { CircleAlertIcon, PlugZapIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

import {
  CONNECTION_HEALTH_HINTS,
  CONNECTION_HEALTH_LABELS,
  formatProviderPrice,
  type ConnectionHealth,
} from "@workspace/core/connections"
import {
  WHATSAPP_MESSAGING_TIER_LABELS,
  WHATSAPP_QUALITY_LABELS,
  whatsappQualityRequiresSuspension,
} from "@workspace/core/whatsapp"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import {
  disconnectConnectionAction,
  refreshWhatsappChannelAction,
  setConnectionEnabledAction,
  type ConnectionActionResult,
} from "@/app/(app)/configuracoes/conexoes/actions"
import { WhatsappConnectDialog } from "@/components/configuracoes/whatsapp-connect-dialog"
import { SupportHelpButton } from "@/components/crm/support-help-button"
import type { ConnectionView, WhatsappChannelView } from "@/lib/conexoes/queries"
import { formatDateTime } from "@/lib/format"

type MetaConfig = { appId: string; configId: string; graphVersion: string }

const HEALTH_BADGE: Record<ConnectionHealth, "default" | "secondary" | "outline" | "destructive"> =
  {
    not_connected: "outline",
    pending: "secondary",
    active: "default",
    paused: "secondary",
    blocked: "destructive",
    error: "destructive",
    revoked: "destructive",
  }

function useAction() {
  const [isPending, startTransition] = React.useTransition()

  function run(action: () => Promise<ConnectionActionResult>, successTitle: string) {
    startTransition(async () => {
      const result = await action()

      toast.add(
        result.ok
          ? { title: successTitle, description: result.message, type: "success" }
          : { title: "Não foi possível concluir", description: result.error, type: "error" }
      )
    })
  }

  return { isPending, run }
}

function ChannelRow({
  channel,
  connectedAccountId,
  phoneNumberId,
  canManage,
}: {
  channel: WhatsappChannelView
  connectedAccountId: string
  phoneNumberId: string
  canManage: boolean
}) {
  const { isPending, run } = useAction()
  const suspended = channel.autoSuspendedAt !== null

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {channel.displayPhoneNumber ?? "Número sem identificação"}
          </span>
          <span className="text-xs text-muted-foreground">
            {channel.verifiedName ?? "Nome ainda não aprovado pela Meta"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              whatsappQualityRequiresSuspension(channel.qualityRating) ? "destructive" : "outline"
            }
          >
            Qualidade: {WHATSAPP_QUALITY_LABELS[channel.qualityRating]}
          </Badge>
          <Badge variant="outline">{WHATSAPP_MESSAGING_TIER_LABELS[channel.messagingTier]}</Badge>
        </div>
      </div>

      {suspended ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Envio suspenso automaticamente</AlertTitle>
          <AlertDescription>
            {channel.autoSuspendedReason ??
              "A qualidade do número caiu e o envio foi suspenso para proteger a conta."}{" "}
            Receber mensagens continua funcionando. O envio volta quando a Meta recuperar a nota do
            número.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {channel.lastSyncedAt
            ? `Estado lido da Meta em ${formatDateTime(channel.lastSyncedAt)}`
            : "Estado ainda não lido da Meta"}
        </span>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () => refreshWhatsappChannelAction(connectedAccountId, phoneNumberId),
                "Estado do número atualizado"
              )
            }
          >
            {isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            Testar conexão
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ConnectionCard({
  connection,
  memberNames,
  meta,
  canManage,
}: {
  connection: ConnectionView
  memberNames: Record<string, string>
  meta: MetaConfig | null
  canManage: boolean
}) {
  const { isPending, run } = useAction()
  const { definition, account, health, channels } = connection
  const isWhatsapp = connection.provider === "whatsapp"
  const connectedBy = account?.connectedBy ? memberNames[account.connectedBy] : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {definition.label}
          <Badge variant={HEALTH_BADGE[health]}>{CONNECTION_HEALTH_LABELS[health]}</Badge>
          {definition.status === "soon" ? <Badge variant="secondary">Em breve</Badge> : null}
        </CardTitle>
        <CardDescription>{definition.summary}</CardDescription>
        {account && canManage ? (
          <CardAction>
            <Switch
              aria-label={account.enabled ? "Desligar conexão" : "Ligar conexão"}
              checked={account.enabled && account.blockedAt === null}
              disabled={isPending || account.blockedAt !== null}
              onCheckedChange={(next) =>
                run(
                  () => setConnectionEnabledAction(account.id, next === true),
                  next ? "Conexão ligada" : "Conexão desligada"
                )
              }
            />
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Quem paga o fornecedor fica em destaque, antes de qualquer botão. */}
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">{definition.billing.headline}</p>
          {definition.billing.invoicedBy ? (
            <p className="text-xs text-muted-foreground">
              Fatura emitida por {definition.billing.invoicedBy}.
            </p>
          ) : null}
          {definition.billing.items.length > 0 ? (
            <dl className="mt-1 grid gap-1 text-sm">
              {definition.billing.items.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatProviderPrice(item.millicentsBRL)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {definition.billing.notes.length > 0 ? (
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
              {definition.billing.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">{CONNECTION_HEALTH_HINTS[health]}</p>

        {account?.blockedAt ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Conexão suspensa pela plataforma</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <p>{account.blockedReason ?? "Fale com o suporte para entender e reativar."}</p>
              <SupportHelpButton label="Chamar o suporte" />
            </AlertDescription>
          </Alert>
        ) : null}

        {account?.lastErrorCode ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>O fornecedor recusou a última chamada</AlertTitle>
            <AlertDescription>
              Código {account.lastErrorCode}
              {account.lastErrorAt ? ` em ${formatDateTime(account.lastErrorAt)}` : ""}. Reconecte a
              conta para voltar a enviar.
            </AlertDescription>
          </Alert>
        ) : null}

        {account ? (
          <>
            <Separator />
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                Conectada em {formatDateTime(account.connectedAt)}
                {connectedBy ? ` por ${connectedBy}` : ""}.
              </span>
              <span>Conta no fornecedor: {account.externalAccountId}</span>
            </div>
          </>
        ) : null}

        {channels.length > 0 ? (
          <div className="flex flex-col gap-2">
            {channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                connectedAccountId={account?.id ?? ""}
                phoneNumberId={channel.phoneNumberId}
                canManage={canManage}
              />
            ))}
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap justify-end gap-2">
        {isWhatsapp && canManage && !account && meta ? (
          <WhatsappConnectDialog
            appId={meta.appId}
            configId={meta.configId}
            graphVersion={meta.graphVersion}
            label="Conectar conta da imobiliária"
          />
        ) : null}

        {isWhatsapp && canManage && !account && !meta ? (
          <Alert>
            <PlugZapIcon />
            <AlertTitle>Configuração pendente</AlertTitle>
            <AlertDescription>
              O aplicativo da Meta ainda não está configurado nesta instalação. Assim que as chaves
              forem cadastradas, o botão de conectar aparece aqui.
            </AlertDescription>
          </Alert>
        ) : null}

        {account && canManage ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" disabled={isPending} />}>
              Desconectar
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <TriangleAlertIcon />
                </AlertDialogMedia>
                <AlertDialogTitle>Desconectar {definition.label}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A credencial é apagada na hora e a imobiliária deixa de enviar e receber por aqui.
                  As conversas e o histórico continuam guardados. Para voltar, será preciso conectar
                  a conta de novo. Se você só quer parar por um tempo, use o interruptor.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={isPending}
                  onClick={() =>
                    run(() => disconnectConnectionAction(account.id), "Conta desconectada")
                  }
                >
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Desconectar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export function ConnectionsPanel({
  connections,
  memberNames,
  meta,
  canManage,
}: {
  connections: ConnectionView[]
  memberNames: Record<string, string>
  meta: MetaConfig | null
  canManage: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {connections.map((connection) => (
        <ConnectionCard
          key={connection.provider}
          connection={connection}
          memberNames={memberNames}
          meta={meta}
          canManage={canManage}
        />
      ))}
    </div>
  )
}
