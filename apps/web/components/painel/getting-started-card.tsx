import Link from "next/link"
import {
  BellRingIcon,
  CircleCheckIcon,
  FileSpreadsheetIcon,
  HouseIcon,
  MailIcon,
  MessageCircleIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import {
  buildGettingStarted,
  type GettingStartedStepId,
} from "@workspace/core/onboarding/getting-started"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Progress } from "@workspace/ui/components/progress"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { GettingStartedDismissButton } from "@/components/painel/getting-started-dismiss-button"
import {
  ORGANIZATION_SETTINGS_PATH,
  PROFILE_SETTINGS_PATH,
  TEAM_SETTINGS_PATH,
} from "@/components/shared/settings-config"
import { IMPORT_SETTINGS_PATH } from "@/lib/importacao/constants"
import { getEmailPreferences } from "@/lib/lembretes/preferences"
import { getVapidConfig } from "@/lib/push/config"
import { createClient } from "@/lib/supabase/server"

type StepCopy = {
  title: string
  description: string
  action: string
  href: string
  icon: LucideIcon
}

const STEP_COPY: Record<GettingStartedStepId, StepCopy> = {
  import_spreadsheet: {
    title: "Trazer a sua planilha",
    description: "Clientes, leads e imóveis do Excel ou do Google Planilhas, sem digitar de novo.",
    action: "Importar planilha",
    href: IMPORT_SETTINGS_PATH,
    icon: FileSpreadsheetIcon,
  },
  first_property: {
    title: "Cadastrar o primeiro imóvel",
    description: "Com fotos e preço, pronto para a página do imóvel e os portais.",
    action: "Cadastrar imóvel",
    href: "/imoveis/novo",
    icon: HouseIcon,
  },
  invite_team: {
    title: "Chamar a equipe",
    description: "Convide corretores e a assistente, cada um com o próprio acesso.",
    action: "Convidar equipe",
    href: TEAM_SETTINGS_PATH,
    icon: UsersIcon,
  },
  organization_whatsapp: {
    title: "Informar o WhatsApp da imobiliária",
    description: "Aparece nas páginas dos imóveis para o cliente chamar vocês.",
    action: "Informar WhatsApp",
    href: ORGANIZATION_SETTINGS_PATH,
    icon: MessageCircleIcon,
  },
  phone_alerts: {
    title: "Ligar os avisos no celular",
    description: "Lead novo, visita marcada para você e lembrete de tarefa chegam na hora.",
    action: "Ligar avisos",
    href: PROFILE_SETTINGS_PATH,
    icon: BellRingIcon,
  },
  daily_digest: {
    title: "Receber o resumo das 7h por e-mail",
    description: "Tarefas, visitas e aniversariantes do dia numa mensagem só.",
    action: "Ligar resumo",
    href: PROFILE_SETTINGS_PATH,
    icon: MailIcon,
  },
}

type CountResponse = { count: number | null; error: unknown }

function countOf(response: CountResponse) {
  return response.error ? 0 : (response.count ?? 0)
}

type GettingStartedCardProps = {
  organizationId: string
  userId: string
}

/**
 * "Comece por aqui" (dono e gerente): passos que se marcam sozinhos a partir dos
 * dados reais da imobiliária e das preferências de quem vê. Some quando tudo
 * está pronto ou com "Esconder". Leituras com a sessão (RLS); falha de leitura
 * conta como passo ainda não feito, nunca derruba o painel.
 */
export async function GettingStartedCard({ organizationId, userId }: GettingStartedCardProps) {
  const supabase = await createClient()
  const pushAvailable = getVapidConfig() !== null
  const now = new Date().toISOString()

  const [imports, properties, members, invitations, organization, devices, emailPreferences] =
    await Promise.all([
      supabase
        .from("import_jobs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .not("finished_at", "is", null)
        .is("undone_at", null),
      supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      supabase
        .from("memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("active", true),
      supabase
        .from("invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .gt("expires_at", now),
      supabase.from("organizations").select("phone").eq("id", organizationId).maybeSingle(),
      pushAvailable
        ? supabase
            .from("push_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
        : Promise.resolve(null),
      getEmailPreferences(userId),
    ])

  const progress = buildGettingStarted({
    finishedImports: countOf(imports),
    properties: countOf(properties),
    activeMembers: countOf(members),
    pendingInvitations: countOf(invitations),
    hasOrganizationPhone: Boolean(organization.data?.phone?.trim()),
    pushDevices: devices ? countOf(devices) : null,
    dailyDigestEnabled: emailPreferences?.daily_digest ?? false,
  })

  if (progress.allDone) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comece por aqui</CardTitle>
        <CardDescription>
          {progress.doneCount} de {progress.total} passos prontos. Cada passo se marca sozinho
          quando você conclui.
        </CardDescription>
        <CardAction>
          <GettingStartedDismissButton />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress
          value={Math.round((progress.doneCount / progress.total) * 100)}
          aria-label={`${progress.doneCount} de ${progress.total} passos prontos`}
        />
        <ol className="flex flex-col gap-2">
          {progress.steps.map((step, index) => {
            const copy = STEP_COPY[step.id]
            const Icon = step.done ? CircleCheckIcon : copy.icon

            return (
              <li key={step.id}>
                <Item variant={step.done ? "muted" : "outline"}>
                  <ItemMedia variant="icon">
                    <Icon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-48">
                    <ItemTitle>
                      <span className="sr-only">Passo {index + 1}: </span>
                      {copy.title}
                      {step.done ? <span className="sr-only"> (feito)</span> : null}
                    </ItemTitle>
                    <ItemDescription>{step.done ? "Feito." : copy.description}</ItemDescription>
                  </ItemContent>
                  {step.done ? null : (
                    <ItemActions className="max-sm:w-full">
                      <Button
                        variant="outline"
                        size="sm"
                        className="max-sm:w-full"
                        render={<Link href={copy.href} />}
                        nativeButton={false}
                      >
                        {copy.action}
                      </Button>
                    </ItemActions>
                  )}
                </Item>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

export function GettingStartedCardSkeleton() {
  return <Skeleton className="h-72 w-full rounded-xl" />
}
