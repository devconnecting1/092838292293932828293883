import type { Metadata } from "next"
import { InfoIcon, UserPlusIcon, UsersIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { LeadRoutingBulkReassignDialog } from "@/components/configuracoes/lead-routing-bulk-reassign-dialog"
import { LeadRoutingMemberDialog } from "@/components/configuracoes/lead-routing-member-dialog"
import { LeadRoutingQueue } from "@/components/configuracoes/lead-routing-queue"
import { LeadRoutingSettingsForm } from "@/components/configuracoes/lead-routing-settings-form"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { requireRole } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getMemberName } from "@/lib/clientes/options"
import {
  formatShiftRange,
  getLeadRoutingOverview,
  weekdayLabel,
  WEEKDAY_VALUES,
  type LeadRoutingSettingsValues,
} from "@/lib/leads/routing"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Rodízio de leads",
}

export default async function RodizioPage() {
  const { membership } = await requireRole(TEAM_MANAGER_ROLES)
  const organizationId = membership.organizationId
  const supabase = await createClient()

  const [overview, organizationMembers] = await Promise.all([
    getLeadRoutingOverview(supabase, organizationId),
    getOrganizationMembers(organizationId),
  ])

  const { settings, members, totals } = overview

  const settingsValues: LeadRoutingSettingsValues = {
    rouletteEnabled: settings.rouletteEnabled,
    respectSchedule: settings.respectSchedule,
    fallbackToPageAssignee: settings.fallbackToPageAssignee,
    slaReassignEnabled: settings.slaReassignEnabled,
    slaMinutes: settings.slaMinutes,
    slaWarningPercent: settings.slaWarningPercent,
    maxReassignments: settings.maxReassignments,
    timeZone: settings.timeZone,
  }

  const queuedUserIds = members.map((member) => member.userId)
  const openLeadsByUser = Object.fromEntries(
    members.map((member) => [member.userId, member.openLeads])
  )

  // Escala da semana montada a partir da própria fila (nenhuma consulta extra).
  const weeklySchedule = WEEKDAY_VALUES.map((weekday) => ({
    weekday,
    windows: members
      .flatMap((member) =>
        member.shifts
          .filter((shift) => shift.weekday === weekday)
          .map((shift) => ({
            key: shift.id,
            name: getMemberName(organizationMembers, member.userId, "Ex-membro"),
            range: formatShiftRange(shift),
            startMinute: shift.startMinute,
          }))
      )
      .sort((a, b) => a.startMinute - b.startMinute || a.name.localeCompare(b.name, "pt-BR")),
  }))

  const alwaysAvailable = members.filter((member) => member.shifts.length === 0)

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Rodízio de leads"
          description="Quem recebe cada lead que chega, em que horários e em quanto tempo precisa responder."
        />
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Como os leads são distribuídos</CardTitle>
          <CardDescription>
            Com o rodízio ligado, o CRM entrega cada lead novo ao próximo corretor da fila e cobra o
            primeiro contato dentro do prazo. Com ele desligado, vale a regra de sempre: o lead fica
            com o responsável fixo da página de captação e, sem responsável, qualquer corretor pode
            assumir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadRoutingSettingsForm defaultValues={settingsValues} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fila do rodízio</CardTitle>
          <CardDescription>
            A ordem é sempre a mesma: recebe quem pegou menos leads hoje, considerando o peso de
            cada um. Empatou, leva quem está há mais tempo sem receber.
          </CardDescription>
          <CardAction>
            <LeadRoutingMemberDialog
              organizationMembers={organizationMembers}
              queuedUserIds={queuedUserIds}
              trigger={<Button />}
            >
              <UserPlusIcon data-icon="inline-start" />
              Adicionar corretor
            </LeadRoutingMemberDialog>
          </CardAction>
        </CardHeader>
        <CardContent>
          <LeadRoutingQueue
            members={members}
            organizationMembers={organizationMembers}
            rouletteEnabled={settings.rouletteEnabled}
            respectSchedule={settings.respectSchedule}
            totals={totals}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Escala de plantão</CardTitle>
          <CardDescription>
            Os horários de cada corretor ficam no botão &quot;Editar&quot; da fila acima. Aqui você
            confere como a semana ficou, no fuso da imobiliária.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert>
            <InfoIcon />
            <AlertTitle>Corretor sem nenhuma janela cadastrada atende sempre</AlertTitle>
            <AlertDescription>
              Só cadastre janelas para quem atende em horários específicos. E lembre: a escala só é
              respeitada se a opção &quot;Respeitar a escala de plantão&quot; estiver ligada.
            </AlertDescription>
          </Alert>

          {alwaysAvailable.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Atendem em qualquer horário:</span>
              {alwaysAvailable.map((member) => (
                <Badge key={member.id} variant="secondary">
                  {getMemberName(organizationMembers, member.userId, "Ex-membro")}
                </Badge>
              ))}
            </div>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead>Quem está de plantão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklySchedule.map((day) => (
                <TableRow key={day.weekday}>
                  <TableCell className="font-medium">{weekdayLabel(day.weekday)}</TableCell>
                  <TableCell>
                    {day.windows.length === 0 ? (
                      <span className="text-muted-foreground">
                        Sem plantão cadastrado neste dia
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {day.windows.map((window) => (
                          <span key={window.key}>
                            {window.name} · {window.range}
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quando um corretor sai</CardTitle>
          <CardDescription>
            Passe de uma vez os leads de quem saiu, entrou de férias longas ou trocou de carteira.
            Nada é apagado: cada troca fica registrada no histórico do lead.
          </CardDescription>
          <CardAction>
            <LeadRoutingBulkReassignDialog
              organizationMembers={organizationMembers}
              openLeadsByUser={openLeadsByUser}
              rouletteEnabled={settings.rouletteEnabled}
              trigger={<Button variant="outline" />}
            >
              <UsersIcon data-icon="inline-start" />
              Passar leads de um corretor
            </LeadRoutingBulkReassignDialog>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Alert>
            <InfoIcon />
            <AlertTitle>Duas formas de fazer</AlertTitle>
            <AlertDescription>
              Escolha um novo responsável para transferir tudo para uma pessoa, ou devolva os leads
              para a roleta e deixe o CRM dividir entre quem está de plantão. Por padrão só os leads
              em aberto são movidos; ganhos e perdidos ficam como estão.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </PageShell>
  )
}
