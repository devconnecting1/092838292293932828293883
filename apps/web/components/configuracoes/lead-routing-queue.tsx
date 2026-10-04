"use client"

import * as React from "react"
import {
  CircleAlertIcon,
  InfoIcon,
  PencilIcon,
  ShuffleIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@workspace/ui/components/item"
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

import { removeLeadRoutingMember } from "@/app/(app)/configuracoes/rodizio/actions"
import { LeadRoutingMemberDialog } from "@/components/configuracoes/lead-routing-member-dialog"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"
import { formatNumber } from "@/lib/format"
import {
  formatShiftRange,
  LEAD_ROUTING_MEMBER_STATUS_LABELS,
  leadRoutingMemberStatus,
  weekdayShortLabel,
  type LeadRoutingMemberStatus,
  type LeadRoutingQueueMember,
  type LeadRoutingTotals,
} from "@/lib/leads/routing"

const STATUS_VARIANTS: Record<
  LeadRoutingMemberStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  ready: "secondary",
  paused: "outline",
  away: "outline",
  off_shift: "outline",
  left_team: "destructive",
}

function StatusBadge({ status }: { status: LeadRoutingMemberStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]}>{LEAD_ROUTING_MEMBER_STATUS_LABELS[status]}</Badge>
  )
}

function ShiftsCell({ shifts }: { shifts: LeadRoutingQueueMember["shifts"] }) {
  if (shifts.length === 0) {
    return <span className="text-muted-foreground">Atende sempre</span>
  }

  const visible = shifts.slice(0, 3)
  const rest = shifts.length - visible.length

  return (
    <div className="flex min-w-44 flex-col gap-1">
      {visible.map((shift) => (
        <span key={shift.id} className="flex items-center gap-2">
          <Badge variant="outline">{weekdayShortLabel(shift.weekday)}</Badge>
          <span>{formatShiftRange(shift)}</span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-muted-foreground">
          e mais {rest} {rest === 1 ? "janela" : "janelas"}
        </span>
      ) : null}
    </div>
  )
}

function QueueRow({
  member,
  name,
  organizationMembers,
  queuedUserIds,
  respectSchedule,
}: {
  member: LeadRoutingQueueMember
  name: string
  organizationMembers: MemberOption[]
  queuedUserIds: string[]
  respectSchedule: boolean
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const status = leadRoutingMemberStatus(member, respectSchedule)

  function onRemove() {
    startTransition(async () => {
      const result = await removeLeadRoutingMember(member.id)

      if (result.ok) {
        setConfirmOpen(false)
        toast.add({ title: result.message ?? "Corretor retirado da fila.", type: "success" })
        return
      }

      toast.add({
        title: "Não foi possível retirar da fila",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-44 flex-col">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground">
            {member.role ? ROLE_LABELS[member.role] : "Fora da equipe"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell>{member.weight}</TableCell>
      <TableCell>
        {member.dailyLimit === null ? (
          <span className="text-muted-foreground">Sem limite</span>
        ) : (
          `${member.assignedToday}/${member.dailyLimit}`
        )}
      </TableCell>
      <TableCell>{member.assignedToday}</TableCell>
      <TableCell>{member.openLeads}</TableCell>
      <TableCell>
        {member.overdueLeads > 0 ? (
          <Badge variant="destructive">{member.overdueLeads}</Badge>
        ) : (
          member.overdueLeads
        )}
      </TableCell>
      <TableCell>
        {member.avgFirstResponseMinutes === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          `${formatNumber(member.avgFirstResponseMinutes)} min`
        )}
      </TableCell>
      <TableCell>
        <ShiftsCell shifts={member.shifts} />
      </TableCell>
      <TableCell className="text-end">
        <div className="flex items-center justify-end gap-1">
          <LeadRoutingMemberDialog
            organizationMembers={organizationMembers}
            member={member}
            queuedUserIds={queuedUserIds}
            trigger={<Button variant="ghost" size="sm" />}
          >
            <PencilIcon data-icon="inline-start" />
            Editar
          </LeadRoutingMemberDialog>
          <AlertDialog
            open={confirmOpen}
            onOpenChange={(open) => {
              if (!isPending) setConfirmOpen(open)
            }}
          >
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={isPending}
                  aria-label={`Retirar ${name} da fila`}
                />
              }
            >
              <UserMinusIcon />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Retirar {name} da fila do rodízio?</AlertDialogTitle>
                <AlertDialogDescription>
                  A pessoa continua na equipe e com os leads que já são dela; só para de receber
                  leads novos pelo rodízio. As janelas de plantão dela são apagadas. Para transferir
                  os leads em aberto, use &quot;Quando um corretor sai&quot;.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={isPending} onClick={onRemove}>
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Retirar da fila
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function LeadRoutingQueue({
  members,
  organizationMembers,
  rouletteEnabled,
  respectSchedule,
  totals,
}: {
  members: LeadRoutingQueueMember[]
  organizationMembers: MemberOption[]
  rouletteEnabled: boolean
  respectSchedule: boolean
  totals: LeadRoutingTotals
}) {
  const queuedUserIds = members.map((member) => member.userId)
  const inTimePercent =
    totals.answered7d > 0 ? Math.round((totals.answeredInTime7d / totals.answered7d) * 100) : null

  const stats = [
    { label: "Leads que chegaram hoje", value: String(totals.leadsToday) },
    { label: "Sem responsável agora", value: String(totals.unassigned) },
    { label: "Esperando a próxima janela", value: String(totals.queued) },
    { label: "Fora do prazo agora", value: String(totals.overdue) },
    { label: "Redistribuídos (7 dias)", value: String(totals.reassigned7d) },
    {
      label: "Respondidos no prazo (7 dias)",
      value: inTimePercent === null ? "—" : `${inTimePercent}%`,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Item key={stat.label} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle>{stat.value}</ItemTitle>
              <ItemDescription>{stat.label}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </div>

      {rouletteEnabled && members.length === 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>O rodízio está ligado, mas a fila está vazia</AlertTitle>
          <AlertDescription>
            Sem ninguém na fila, nenhum lead é distribuído automaticamente. Adicione pelo menos um
            corretor ou desligue o rodízio.
          </AlertDescription>
        </Alert>
      ) : null}

      {!rouletteEnabled && members.length > 0 ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>A fila só entra em ação com o rodízio ligado</AlertTitle>
          <AlertDescription>
            Você pode deixar tudo preparado e ligar a distribuição automática quando quiser.
          </AlertDescription>
        </Alert>
      ) : null}

      {members.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShuffleIcon />
            </EmptyMedia>
            <EmptyTitle>Ninguém na fila ainda</EmptyTitle>
            <EmptyDescription>
              Adicione os corretores que devem receber os leads que chegam pelo site e pelos
              portais.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <LeadRoutingMemberDialog
              organizationMembers={organizationMembers}
              queuedUserIds={queuedUserIds}
              trigger={<Button />}
            >
              <UserPlusIcon data-icon="inline-start" />
              Adicionar corretor
            </LeadRoutingMemberDialog>
          </EmptyContent>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Corretor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Peso</TableHead>
              <TableHead>Limite do dia</TableHead>
              <TableHead>Leads hoje</TableHead>
              <TableHead>Em aberto</TableHead>
              <TableHead>Fora do prazo</TableHead>
              <TableHead>1º contato</TableHead>
              <TableHead>Plantão</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              // A chave é só o id para o diálogo aberto sobreviver ao
              // revalidatePath de cada janela de plantão adicionada.
              <QueueRow
                key={member.id}
                member={member}
                name={getMemberName(organizationMembers, member.userId, "Ex-membro")}
                organizationMembers={organizationMembers}
                queuedUserIds={queuedUserIds}
                respectSchedule={respectSchedule}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
