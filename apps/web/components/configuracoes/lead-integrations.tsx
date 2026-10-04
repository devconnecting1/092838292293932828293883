"use client"

import * as React from "react"
import Link from "next/link"
import {
  CircleCheckIcon,
  ExternalLinkIcon,
  InfoIcon,
  PlugIcon,
  PlugZapIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"

import {
  describeLeadIngestReason,
  LEAD_DELIVERY_STATUS_LABELS,
  LEAD_INGEST_ORIGIN_LABELS,
  LEAD_INGEST_PROVIDER_LABELS,
  type LeadDeliveryStatus,
  type LeadIngestOrigin,
  type LeadIngestProvider,
} from "@workspace/core/leads/ingest"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/toast"

import {
  connectMetaLeadAds,
  disconnectIntegration,
  enableCanalProWebhook,
  testIntegration,
} from "@/app/(app)/configuracoes/integracoes/actions"
import { CopyField } from "@/components/configuracoes/copy-field"
import { formatDateTime } from "@/lib/format"
import { PROVIDER_COPY } from "@/lib/integracoes/constants"
import type { LeadDelivery, LeadIntegration } from "@/lib/integracoes/queries"
import {
  META_CONNECTION_DEFAULTS,
  metaConnectionSchema,
  type MetaConnectionValues,
} from "@/lib/integracoes/schemas"

// -----------------------------------------------------------------------------
// Peças comuns
// -----------------------------------------------------------------------------

function StatusBadge({ integration }: { integration: LeadIntegration }) {
  if (integration.status === "connected") {
    return (
      <Badge variant="secondary">
        <CircleCheckIcon data-icon="inline-start" />
        Conectado
      </Badge>
    )
  }

  if (integration.status === "error") {
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon data-icon="inline-start" />
        Com problema
      </Badge>
    )
  }

  return <Badge variant="outline">Desconectado</Badge>
}

function LastEvent({ integration }: { integration: LeadIntegration }) {
  if (integration.status !== "connected") {
    return null
  }

  return (
    <FieldDescription>
      {integration.lastEventAt
        ? `Última entrega recebida em ${formatDateTime(integration.lastEventAt)}.`
        : "Nenhuma entrega recebida ainda."}
      {integration.lastTestAt ? ` Último teste em ${formatDateTime(integration.lastTestAt)}.` : ""}
    </FieldDescription>
  )
}

function IntegrationError({ integration }: { integration: LeadIntegration }) {
  if (!integration.lastError) {
    return null
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>A origem recusou a última conversa</AlertTitle>
      <AlertDescription>
        {integration.lastError}
        {integration.lastErrorAt ? ` (${formatDateTime(integration.lastErrorAt)})` : ""}
      </AlertDescription>
    </Alert>
  )
}

function HowTo({ provider }: { provider: LeadIngestProvider }) {
  const copy = PROVIDER_COPY[provider]

  return (
    <div className="flex flex-col gap-2">
      <ol className="ml-4 list-decimal text-sm text-muted-foreground [&>li]:mt-1">
        {copy.howTo.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <a
        href={copy.docsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4"
      >
        {copy.docsLabel}
        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
      </a>
    </div>
  )
}

function TestButton({ provider, disabled }: { provider: LeadIngestProvider; disabled?: boolean }) {
  const [isPending, startTransition] = React.useTransition()

  return (
    <Button
      variant="outline"
      disabled={disabled || isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await testIntegration(provider)

          toast.add({
            title: result.ok ? "Conexão testada" : "O teste não passou",
            description: result.ok ? result.message : result.error,
            type: result.ok ? "success" : "error",
          })
        })
      }
    >
      {isPending ? <Spinner data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
      Testar conexão
    </Button>
  )
}

function DisconnectButton({
  provider,
  description,
}: {
  provider: LeadIngestProvider
  description: string
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      <AlertDialogTrigger render={<Button variant="ghost" />}>
        <UnplugIcon data-icon="inline-start" />
        Desconectar
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Desconectar {LEAD_INGEST_PROVIDER_LABELS[provider]}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await disconnectIntegration(provider)

                if (result.ok) {
                  setOpen(false)
                }

                toast.add({
                  title: result.ok ? "Desconectado" : "Não foi possível desconectar",
                  description: result.ok ? result.message : result.error,
                  type: result.ok ? "success" : "error",
                })
              })
            }
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Desconectar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// -----------------------------------------------------------------------------
// Canal Pro (ZAP, Viva Real e OLX)
// -----------------------------------------------------------------------------

export function CanalProCard({
  integration,
  webhookUrl,
}: {
  integration: LeadIntegration
  /** Endereço já montado no servidor; null enquanto não foi gerado. */
  webhookUrl: string | null
}) {
  const [isPending, startTransition] = React.useTransition()
  const copy = PROVIDER_COPY.canal_pro
  // Sem estado local: as ações revalidam a rota e o endereço chega novo do
  // servidor. Um estado aqui só criaria uma segunda verdade para o mesmo dado.
  const url = webhookUrl

  function run(rotate: boolean) {
    startTransition(async () => {
      const result = await enableCanalProWebhook(rotate)

      if (result.ok) {
        toast.add({ title: "Endereço pronto", description: result.message, type: "success" })
        return
      }

      toast.add({
        title: "Não foi possível gerar o endereço",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.summary}</CardDescription>
        <CardAction>
          <StatusBadge integration={integration} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <IntegrationError integration={integration} />

        {url ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="canal-pro-url">Endereço para colar no Canal Pro</FieldLabel>
              <CopyField
                id="canal-pro-url"
                value={url}
                successMessage="Endereço copiado."
                label="Endereço do webhook do Canal Pro"
              />
              <FieldDescription>
                Este endereço é secreto: quem tiver ele consegue criar leads na sua conta. Não
                publique em grupo nem em print. Se vazar, gere um novo aqui — o anterior para de
                funcionar na hora.
              </FieldDescription>
              <LastEvent integration={integration} />
            </Field>
          </FieldGroup>
        ) : null}

        <HowTo provider="canal_pro" />

        <Alert>
          <InfoIcon />
          <AlertTitle>Ligue também o &quot;Receber leads no e-mail&quot;</AlertTitle>
          <AlertDescription>
            No mesmo lugar do Canal Pro existe a opção de receber uma cópia de todo lead por e-mail.
            Deixe ligada: se um dia a integração falhar, você ainda tem o contato. Não atrapalha em
            nada a entrada aqui.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {url ? (
          <>
            <Button variant="outline" disabled={isPending} onClick={() => run(true)}>
              {isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Gerar novo endereço
            </Button>
            <TestButton provider="canal_pro" />
            <DisconnectButton
              provider="canal_pro"
              description="O endereço atual para de funcionar na hora e o Grupo OLX passa a receber erro ao entregar. Desative também a integração no Canal Pro para os leads não ficarem presos lá."
            />
          </>
        ) : (
          <Button disabled={isPending} onClick={() => run(false)}>
            {isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlugIcon data-icon="inline-start" />
            )}
            Gerar endereço e conectar
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Meta Lead Ads
// -----------------------------------------------------------------------------

export function MetaCard({
  integration,
  webhookUrl,
}: {
  integration: LeadIntegration
  /** Endereço do nosso app na Meta; aparece só como referência de configuração. */
  webhookUrl: string
}) {
  const copy = PROVIDER_COPY.meta_lead_ads
  const form = useForm<MetaConnectionValues>({
    resolver: zodResolver(metaConnectionSchema),
    defaultValues: {
      ...META_CONNECTION_DEFAULTS,
      pageId: integration.externalAccountId ?? "",
      pageName: integration.accountLabel ?? "",
    },
  })

  const isConnected = integration.status !== "disconnected" && integration.hasCredential

  async function onSubmit(values: MetaConnectionValues) {
    const result = await connectMetaLeadAds(values)

    if (result.ok) {
      form.setValue("accessToken", "")
      toast.add({
        title: "Conta conectada",
        description: result.message,
        type: "success",
      })
      return
    }

    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      form.setError(field as keyof MetaConnectionValues, { message })
    }

    toast.add({ title: "Não foi possível conectar", description: result.error, type: "error" })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.summary}</CardDescription>
        <CardAction>
          <StatusBadge integration={integration} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <IntegrationError integration={integration} />

        <Alert>
          <InfoIcon />
          <AlertTitle>A conta da Meta é sua, e continua sendo</AlertTitle>
          <AlertDescription>
            A Meta cobra o anúncio direto de você. Nós só recebemos o contato que o formulário
            gerou. Ao desconectar, a credencial guardada aqui é apagada.
          </AlertDescription>
        </Alert>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Controller
              control={form.control}
              name="pageId"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="meta-page-id">ID da Página do Facebook</FieldLabel>
                  <Input
                    {...field}
                    id="meta-page-id"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="123456789012345"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      Está em Configurações da Página, no fim da aba &quot;Informações&quot;.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="pageName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="meta-page-name">Nome da Página (opcional)</FieldLabel>
                  <Input
                    {...field}
                    id="meta-page-name"
                    autoComplete="off"
                    placeholder="Imobiliária Exemplo"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>Serve só para você reconhecer aqui na tela.</FieldDescription>
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="accessToken"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="meta-token">Token de acesso da Página</FieldLabel>
                  <Input
                    {...field}
                    id="meta-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      isConnected ? "Token guardado — cole um novo para trocar" : "EAAG…"
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      Use um token de Página de longa duração. Ele fica guardado cifrado e nunca
                      volta a aparecer nesta tela.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />

            <LastEvent integration={integration} />

            <Field orientation="horizontal">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlugIcon data-icon="inline-start" />
                )}
                {isConnected ? "Atualizar conexão" : "Conectar conta"}
              </Button>
            </Field>
          </FieldGroup>
        </form>

        <HowTo provider="meta_lead_ads" />

        <Field>
          <FieldLabel htmlFor="meta-webhook-url">
            Endereço do webhook (para quem configura o app da Meta)
          </FieldLabel>
          <CopyField
            id="meta-webhook-url"
            value={webhookUrl}
            successMessage="Endereço copiado."
            label="Endereço do webhook da Meta"
          />
          <FieldDescription>
            Este endereço é o mesmo para todas as imobiliárias e já está cadastrado no nosso app.
            Você não precisa fazer nada com ele.
          </FieldDescription>
        </Field>
      </CardContent>
      {isConnected ? (
        <CardFooter className="flex flex-wrap gap-2">
          <TestButton provider="meta_lead_ads" />
          <DisconnectButton
            provider="meta_lead_ads"
            description="A credencial guardada aqui é apagada e paramos de buscar os leads dessa Página. A sua conta e os seus anúncios na Meta não mudam."
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Histórico de entregas
// -----------------------------------------------------------------------------

const STATUS_VARIANT: Record<
  LeadDeliveryStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  accepted: "secondary",
  duplicate: "outline",
  rejected: "destructive",
  failed: "destructive",
  pending: "outline",
  ignored: "outline",
}

function originLabel(origin: string | null) {
  if (!origin) {
    return "—"
  }

  return LEAD_INGEST_ORIGIN_LABELS[origin as LeadIngestOrigin] ?? origin
}

function deliveryExplanation(delivery: LeadDelivery) {
  const reason = describeLeadIngestReason(delivery.reason)

  if (reason) {
    return delivery.detail ? `${reason} (${delivery.detail})` : reason
  }

  if (delivery.status === "accepted") {
    return "Entrou no funil."
  }

  return delivery.detail ?? "—"
}

export function DeliveriesTable({ deliveries }: { deliveries: LeadDelivery[] }) {
  if (deliveries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma entrega ainda</EmptyTitle>
          <EmptyDescription>
            Assim que o primeiro contato chegar de um portal ou de um anúncio, ele aparece aqui —
            inclusive o que for recusado, com o motivo.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Quando</TableHead>
          <TableHead>Origem</TableHead>
          <TableHead>Contato</TableHead>
          <TableHead>Anúncio</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead>O que aconteceu</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery) => (
          <TableRow key={delivery.id}>
            <TableCell className="whitespace-nowrap">
              {formatDateTime(delivery.receivedAt)}
            </TableCell>
            <TableCell>
              <span className="whitespace-nowrap">{originLabel(delivery.origin)}</span>
              <span className="block text-xs text-muted-foreground">
                {LEAD_INGEST_PROVIDER_LABELS[delivery.provider]}
              </span>
            </TableCell>
            <TableCell>
              {delivery.leadId ? (
                <Link href={`/leads/${delivery.leadId}`} className="underline underline-offset-4">
                  {delivery.contactName ?? "Ver o lead"}
                </Link>
              ) : (
                (delivery.contactName ?? "—")
              )}
            </TableCell>
            <TableCell>{delivery.listingCode ?? "—"}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[delivery.status]}>
                {LEAD_DELIVERY_STATUS_LABELS[delivery.status]}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{deliveryExplanation(delivery)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
