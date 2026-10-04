"use client"

import * as React from "react"
import {
  BellIcon,
  BellOffIcon,
  CircleAlertIcon,
  SendIcon,
  ShareIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import {
  disablePushOnDevice,
  enablePushOnDevice,
  getPushDeviceState,
  removePushDevice,
  sendTestPushToDevice,
  type PushActionResult,
} from "@/app/(app)/perfil/push-actions"
import { formatDateTime } from "@/lib/format"
import {
  applicationServerKeyFrom,
  getCurrentPushSubscription,
  getPushSupport,
  getServiceWorkerRegistration,
  serializePushSubscription,
  unsubscribeThisDevice,
  type PushSupport,
} from "@/lib/push/client"

export type PushDevice = {
  id: string
  label: string | null
  createdAt: string
  lastDeliveredAt: string | null
}

type DeviceStatus = { kind: "checking" } | { kind: "off" } | { kind: "on"; subscriptionId: string }

type PendingAction = "enable" | "disable" | "test" | `remove:${string}` | null

function subscribeToNothing() {
  return () => {}
}

/** Suporte do navegador só no cliente (no servidor, "checking"), sem aviso de hidratação. */
function usePushSupport(): PushSupport | "checking" {
  return React.useSyncExternalStore(subscribeToNothing, getPushSupport, () => "checking" as const)
}

function readPermission(): NotificationPermission | null {
  return "Notification" in window ? Notification.permission : null
}

/** Permissão de notificação, relida a cada render (muda depois do pedido no clique). */
function usePermission(): NotificationPermission | null {
  return React.useSyncExternalStore(subscribeToNothing, readPermission, () => null)
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array) {
  if (!current || current.byteLength !== expected.byteLength) {
    return false
  }

  const bytes = new Uint8Array(current)
  return bytes.every((value, index) => value === expected[index])
}

/** Inscrição deste navegador com a chave VAPID atual (refaz se a chave mudou). */
async function subscribeWithKey(publicKey: string): Promise<PushSubscription> {
  const registration = await getServiceWorkerRegistration()
  await navigator.serviceWorker.ready

  const applicationServerKey = applicationServerKeyFrom(publicKey)
  const existing = await registration.pushManager.getSubscription()

  if (existing && sameKey(existing.options.applicationServerKey, applicationServerKey)) {
    return existing
  }

  if (existing) {
    await existing.unsubscribe()
  }

  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
}

function showResult(result: PushActionResult, errorTitle: string) {
  if (result.ok) {
    if (result.message) {
      toast.add({ title: result.message, type: "success" })
    }
    return
  }

  toast.add({ title: errorTitle, description: result.error, type: "error" })
}

export function PushSettings({
  publicKey,
  devices,
}: {
  /** NEXT_PUBLIC_VAPID_PUBLIC_KEY validada no servidor. */
  publicKey: string
  /** Aparelhos ligados do usuário (sem endpoint nem chaves). */
  devices: PushDevice[]
}) {
  const support = usePushSupport()
  const permission = usePermission()
  const [status, setStatus] = React.useState<DeviceStatus>({ kind: "checking" })
  const [pending, setPending] = React.useState<PendingAction>(null)
  const [, startTransition] = React.useTransition()

  // Estado do aparelho atual: inscrição do navegador + registro no servidor.
  React.useEffect(() => {
    if (support !== "supported") {
      return
    }

    let cancelled = false

    getCurrentPushSubscription()
      .then(async (subscription) => {
        if (!subscription) {
          return { kind: "off" } as const
        }

        const result = await getPushDeviceState(serializePushSubscription(subscription))
        return result.ok && result.subscriptionId
          ? ({ kind: "on", subscriptionId: result.subscriptionId } as const)
          : ({ kind: "off" } as const)
      })
      .catch(() => ({ kind: "off" }) as const)
      .then((next) => {
        if (!cancelled) {
          setStatus(next)
        }
      })

    return () => {
      cancelled = true
    }
  }, [support])

  const currentId = status.kind === "on" ? status.subscriptionId : null
  const busy = pending !== null

  function run(action: Exclude<PendingAction, null>, task: () => Promise<void>) {
    setPending(action)
    startTransition(async () => {
      try {
        await task()
      } catch {
        toast.add({
          title: "Não foi possível concluir",
          description: "O navegador recusou o pedido. Atualize a página e tente de novo.",
          type: "error",
        })
      } finally {
        setPending(null)
      }
    })
  }

  function enable() {
    run("enable", async () => {
      // Pedido de permissão direto no clique (exigência do Safari no iPhone).
      const answer = await Notification.requestPermission()

      if (answer !== "granted") {
        toast.add({
          title: "Avisos não ligados",
          description:
            answer === "denied"
              ? "As notificações ficaram bloqueadas para este site. Libere nas configurações do navegador."
              : "Permita as notificações para receber os avisos neste aparelho.",
          type: "error",
        })
        return
      }

      const subscription = await subscribeWithKey(publicKey)
      const result = await enablePushOnDevice(serializePushSubscription(subscription))

      if (result.ok && result.subscriptionId) {
        setStatus({ kind: "on", subscriptionId: result.subscriptionId })
      }

      showResult(result, "Avisos não ligados")
    })
  }

  function disable() {
    run("disable", async () => {
      const current = await getCurrentPushSubscription().catch(() => null)
      const endpoint = current?.endpoint ?? null
      await unsubscribeThisDevice().catch(() => null)
      const result = await disablePushOnDevice(endpoint)

      setStatus({ kind: "off" })
      showResult(result, "Não foi possível desligar")
    })
  }

  function sendTest() {
    run("test", async () => {
      const subscription = await getCurrentPushSubscription()

      if (!subscription) {
        setStatus({ kind: "off" })
        toast.add({
          title: "Avisos desligados",
          description: "Ligue os avisos neste aparelho para mandar o teste.",
          type: "error",
        })
        return
      }

      const result = await sendTestPushToDevice(serializePushSubscription(subscription))

      if (!result.ok && result.reason) {
        setStatus({ kind: "off" })
      }

      showResult(result, "Teste não enviado")
    })
  }

  function remove(device: PushDevice) {
    if (device.id === currentId) {
      disable()
      return
    }

    run(`remove:${device.id}`, async () => {
      showResult(await removePushDevice(device.id), "Não foi possível remover")
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {support === "ios-needs-home-screen" ? (
        <Alert>
          <ShareIcon />
          <AlertTitle>No iPhone e no iPad, adicione o CRM à tela de início</AlertTitle>
          <AlertDescription>
            <ol className="list-decimal ps-4">
              <li>No Safari, toque em Compartilhar.</li>
              <li>Escolha &quot;Adicionar à Tela de Início&quot;.</li>
              <li>Abra o CRM pelo novo ícone, entre em Meu perfil e ligue os avisos.</li>
            </ol>
            <p>Funciona no iOS e no iPadOS 16.4 ou mais novos.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {support === "unsupported" ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Este navegador não recebe avisos</AlertTitle>
          <AlertDescription>
            Use o Chrome, o Edge, o Firefox ou o Safari atualizados. No celular, abra o CRM pelo
            navegador principal do aparelho.
          </AlertDescription>
        </Alert>
      ) : null}

      {support === "supported" && permission === "denied" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Notificações bloqueadas neste navegador</AlertTitle>
          <AlertDescription>
            Libere as notificações deste site nas configurações do navegador (no ícone ao lado do
            endereço) e atualize a página.
          </AlertDescription>
        </Alert>
      ) : null}

      {support === "supported" || support === "checking" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Este aparelho</span>
              {status.kind === "on" ? (
                <Badge variant="secondary">Ligado</Badge>
              ) : status.kind === "off" ? (
                <Badge variant="outline">Desligado</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {status.kind === "on"
                ? "Lead novo, prazo acabando, lead redistribuído e prazo estourado chegam aqui na hora."
                : status.kind === "off"
                  ? "Ligue para receber lead novo e prazo de primeiro contato na hora, mesmo com o CRM fechado."
                  : "Verificando este aparelho..."}
            </p>
          </div>

          {status.kind === "on" ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={busy} onClick={sendTest}>
                {pending === "test" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SendIcon data-icon="inline-start" />
                )}
                Enviar notificação de teste
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={disable}>
                {pending === "disable" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <BellOffIcon data-icon="inline-start" />
                )}
                Desligar neste aparelho
              </Button>
            </div>
          ) : status.kind === "off" && permission !== "denied" ? (
            <Button type="button" disabled={busy} onClick={enable}>
              {pending === "enable" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BellIcon data-icon="inline-start" />
              )}
              Ligar avisos neste aparelho
            </Button>
          ) : null}
        </div>
      ) : null}

      {devices.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Aparelhos com avisos ligados</h3>
          <ItemGroup className="gap-2">
            {devices.map((device) => {
              const isCurrent = device.id === currentId
              const label = device.label ?? "Aparelho sem nome"

              return (
                <Item key={device.id} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <SmartphoneIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-none flex-wrap">
                      {label}
                      {isCurrent ? <Badge variant="secondary">Este aparelho</Badge> : null}
                    </ItemTitle>
                    <ItemDescription>
                      Ligado em {formatDateTime(device.createdAt)}
                      {device.lastDeliveredAt
                        ? ` · último aviso em ${formatDateTime(device.lastDeliveredAt)}`
                        : ""}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => remove(device)}
                    >
                      {pending === `remove:${device.id}` || (isCurrent && pending === "disable") ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Trash2Icon data-icon="inline-start" />
                      )}
                      Remover
                      <span className="sr-only"> {label}</span>
                    </Button>
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        O aviso mostra só o nome e a origem do lead; telefone e conversa ficam no CRM. No iPhone e
        no iPad, os avisos só chegam com o CRM adicionado à tela de início.
      </p>
    </div>
  )
}
