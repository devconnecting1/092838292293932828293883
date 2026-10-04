import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { after } from "next/server"
import {
  ArrowUpRightIcon,
  CalendarCheckIcon,
  HouseIcon,
  ListTodoIcon,
  PlusIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import {
  PainelCommissionCard,
  PainelCommissionCardSkeleton,
} from "@/components/comissoes/painel-commission-card"
import { SupportHelpButton } from "@/components/crm/support-help-button"
import { getFirstName } from "@/components/crm/utils"
import {
  AuthorizationAlertsCard,
  AuthorizationAlertsCardSkeleton,
} from "@/components/painel/authorization-alerts-card"
import { BirthdaysCard, BirthdaysCardSkeleton } from "@/components/painel/birthdays-card"
import {
  GettingStartedCard,
  GettingStartedCardSkeleton,
} from "@/components/painel/getting-started-card"
import {
  LeadsFunnelCard,
  LeadsWeeklyCard,
  PainelChartSkeleton,
  PropertiesStatusCard,
} from "@/components/painel/painel-charts"
import { UndeliveredEmailsCard } from "@/components/painel/undelivered-emails-card"
import { ROLE_PERMISSIONS_SETTINGS_PATH } from "@/components/shared/settings-config"
import { ROLE_LABELS, TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { drainStoragePurgeQueue } from "@/lib/lixeira/storage"
import { getDisplayPreferences } from "@/lib/preferencias/display"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Painel",
}

const TIME_ZONE = "America/Sao_Paulo"
/** O Brasil não tem horário de verão desde 2019: Brasília é sempre UTC-3. */
const BRASILIA_UTC_OFFSET = "-03:00"
const ONE_DAY_MS = 24 * 60 * 60 * 1000
/** Arquivos da fila do Storage removidos por visita ao Painel (depois da resposta). */
const PAINEL_STORAGE_PURGE_BATCH = 50

function getTodayRange(now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)

  const start = new Date(`${today}T00:00:00${BRASILIA_UTC_OFFSET}`)
  const end = new Date(start.getTime() + ONE_DAY_MS)

  return { start: start.toISOString(), end: end.toISOString() }
}

type CountResponse = {
  count: number | null
  error: { message: string } | null
}

function readCount(response: CountResponse) {
  return response.error ? null : (response.count ?? 0)
}

type Metric = {
  label: string
  value: number | null
  hint: string
  href: string
  icon: LucideIcon
}

const numberFormat = new Intl.NumberFormat("pt-BR")

type PainelPageProps = {
  searchParams: Promise<{ erro?: string | string[] }>
}

export default async function PainelPage({ searchParams }: PainelPageProps) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])

  const supabase = await createClient()
  const organizationId = membership.organizationId

  // Arquivos de registros apagados (lixeira, pedido do titular, rotina diária)
  // saem do Storage aos poucos quando dono ou gerente abre o Painel, depois da
  // resposta: não atrasa a página. O cliente é criado na renderização porque,
  // em Server Component, cookies() não pode ser lido dentro do after().
  if (TEAM_MANAGER_ROLES.includes(membership.role)) {
    after(async () => {
      try {
        await drainStoragePurgeQueue(supabase, organizationId, {
          limit: PAINEL_STORAGE_PURGE_BATCH,
        })
      } catch (error) {
        console.error(
          "[lixeira] limpeza do Storage pelo Painel falhou",
          error instanceof Error ? error.name : "erro"
        )
      }
    })
  }
  const showGettingStarted =
    TEAM_MANAGER_ROLES.includes(membership.role) &&
    !(await getDisplayPreferences(user.id)).gettingStartedDismissed
  const now = new Date()
  const { start, end } = getTodayRange(now)

  const [properties, clients, appointments, tasks] = await Promise.all([
    supabase
      .from("properties")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "active"),
    supabase
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("starts_at", start)
      .lt("starts_at", end)
      .neq("status", "canceled"),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .lt("due_at", end),
  ])

  const activeProperties = readCount(properties)
  const clientCount = readCount(clients)

  const metrics: Metric[] = [
    {
      label: "Imóveis ativos",
      value: activeProperties,
      hint: "Disponíveis para venda ou locação",
      href: "/imoveis",
      icon: HouseIcon,
    },
    {
      label: "Clientes",
      value: clientCount,
      hint: "Pessoas e empresas cadastradas",
      href: "/clientes",
      icon: UsersIcon,
    },
    {
      label: "Visitas hoje",
      value: readCount(appointments),
      hint: "Agendadas para hoje",
      href: "/agenda",
      icon: CalendarCheckIcon,
    },
    {
      label: "Tarefas vencendo",
      value: readCount(tasks),
      hint: "Abertas com prazo até hoje, incluindo atrasadas",
      href: "/tarefas",
      icon: ListTodoIcon,
    },
  ]

  const hasLoadError = metrics.some((metric) => metric.value === null)
  const firstName = getFirstName(user.fullName)
  const today = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now)

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-1 px-4 lg:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Olá, ${firstName}` : "Olá"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Resumo de {membership.organization.name} para {today}.
        </p>
      </div>

      {params.erro === "sem-permissao" ? (
        <div className="px-4 lg:px-6">
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>Acesso restrito</AlertTitle>
            <AlertDescription>
              <p>
                Seu papel nesta imobiliária ({ROLE_LABELS[membership.role]}) não permite abrir
                aquela área. Veja{" "}
                <Link href={ROLE_PERMISSIONS_SETTINGS_PATH}>o que cada papel pode fazer</Link> ou
                peça ao dono ou ao gerente da imobiliária.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {hasLoadError ? (
        <div className="px-4 lg:px-6">
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Alguns indicadores não carregaram</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <p>Recarregue a página em instantes.</p>
              <SupportHelpButton label="Chamar o suporte" />
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {/* Primeiros passos (dono e gerente): some quando tudo está pronto ou com "Esconder". */}
      {showGettingStarted ? (
        <div className="px-4 lg:px-6">
          <Suspense fallback={<GettingStartedCardSkeleton />}>
            <GettingStartedCard organizationId={organizationId} userId={user.id} />
          </Suspense>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        {metrics.map((metric) => (
          <Card key={metric.label} className="@container/card">
            <CardHeader>
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {metric.value === null ? "—" : numberFormat.format(metric.value)}
              </CardTitle>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  render={<Link href={metric.href} />}
                  nativeButton={false}
                >
                  <metric.icon />
                  <span className="sr-only">Abrir {metric.label}</span>
                </Button>
              </CardAction>
            </CardHeader>
            <CardFooter className="text-muted-foreground">{metric.hint}</CardFooter>
          </Card>
        ))}
      </div>

      {/* Comissão onde o corretor já olha: carrega sozinha, sem segurar o painel. */}
      <div className="px-4 lg:px-6">
        <Suspense fallback={<PainelCommissionCardSkeleton />}>
          <PainelCommissionCard userId={user.id} role={membership.role} />
        </Suspense>
      </div>

      {/* Avisos que a cota diária de e-mail segurou: quem gerencia precisa saber. */}
      {TEAM_MANAGER_ROLES.includes(membership.role) ? (
        <Suspense fallback={null}>
          <UndeliveredEmailsCard organizationId={organizationId} />
        </Suspense>
      ) : null}

      {/* Autorização vencendo: anunciar sem contrato vigente expõe a comissão. */}
      <div className="px-4 lg:px-6">
        <Suspense fallback={<AuthorizationAlertsCardSkeleton />}>
          <AuthorizationAlertsCard organizationId={organizationId} />
        </Suspense>
      </div>

      {/* Aniversariantes: parabéns no dia certo é o que traz o cliente antigo de volta. */}
      <div className="px-4 lg:px-6">
        <Suspense fallback={<BirthdaysCardSkeleton />}>
          <BirthdaysCard
            organizationId={organizationId}
            organizationName={membership.organization.name}
          />
        </Suspense>
      </div>

      {activeProperties === 0 || clientCount === 0 ? (
        <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @3xl/main:grid-cols-2">
          {activeProperties === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HouseIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhum imóvel ativo</EmptyTitle>
                <EmptyDescription>
                  Cadastre o primeiro imóvel para publicar nos portais e começar a receber
                  interessados.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button render={<Link href="/imoveis" />} nativeButton={false}>
                  <PlusIcon data-icon="inline-start" />
                  Cadastrar imóvel
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {clientCount === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhum cliente cadastrado</EmptyTitle>
                <EmptyDescription>
                  Cadastre compradores, inquilinos e proprietários para acompanhar visitas,
                  propostas e o perfil de busca de cada um.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" render={<Link href="/clientes" />} nativeButton={false}>
                  <PlusIcon data-icon="inline-start" />
                  Cadastrar cliente
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
        </div>
      ) : null}

      {/* Cada gráfico carrega sozinho: uma consulta lenta não segura o painel. */}
      <section
        aria-label="Indicadores em gráfico"
        className="grid grid-cols-1 gap-4 px-4 lg:px-6 @4xl/main:grid-cols-2"
      >
        <div className="@4xl/main:col-span-2">
          <Suspense fallback={<PainelChartSkeleton title="os leads por semana" />}>
            <LeadsWeeklyCard organizationId={organizationId} />
          </Suspense>
        </div>
        <Suspense fallback={<PainelChartSkeleton title="o funil de leads" />}>
          <LeadsFunnelCard organizationId={organizationId} />
        </Suspense>
        <Suspense fallback={<PainelChartSkeleton title="os imóveis por status" />}>
          <PropertiesStatusCard organizationId={organizationId} />
        </Suspense>
      </section>
    </div>
  )
}
