import { CrownIcon, UsersIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import {
  TeamAddMembersDialog,
  type AddMemberCandidate,
} from "@/components/equipes/team-add-members-dialog"
import { TeamFormDialog, type LeaderOption } from "@/components/equipes/team-form-dialog"
import { TeamLeaderDialog } from "@/components/equipes/team-leader-dialog"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { deleteTeam, removeTeamMember } from "@/lib/equipes/actions"
import type { TeamPerson } from "@/lib/equipes/queries"

export type TeamCardData = {
  id: string
  name: string
  leader: TeamPerson | null
  members: TeamPerson[]
}

export function TeamCard({
  team,
  canEdit,
  highlightUserId,
  leaderOptions,
  addCandidates,
}: {
  team: TeamCardData
  canEdit: boolean
  /** Quem está vendo a página (marca "você"). */
  highlightUserId: string
  leaderOptions: readonly LeaderOption[]
  addCandidates: readonly AddMemberCandidate[]
}) {
  const count = team.members.length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="break-words">{team.name}</span>
          <Badge variant="secondary">
            <UsersIcon data-icon="inline-start" />
            {count === 1 ? "1 pessoa" : `${count} pessoas`}
          </Badge>
        </CardTitle>
        <CardDescription>
          {team.leader
            ? `Líder: ${team.leader.name}${team.leader.id === highlightUserId ? " (você)" : ""}`
            : "Sem líder: só o dono e o gerente veem o subtotal desta equipe."}
        </CardDescription>
        {canEdit ? (
          <CardAction>
            <ConfirmDeleteButton
              action={deleteTeam.bind(null, team.id)}
              label={`Excluir a ${team.name}`}
              title={`Excluir a ${team.name}?`}
              description="As pessoas ficam sem equipe e as metas desta equipe são apagadas. Os números de cada corretor não mudam e nenhum lead, cliente ou proposta é excluído."
              confirmLabel="Excluir equipe"
            />
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguém nesta equipe ainda.{" "}
            {canEdit ? "Use “Incluir pessoas” para montar a equipe." : null}
          </p>
        ) : (
          <ItemGroup className="gap-1" aria-label={`Pessoas da ${team.name}`}>
            {team.members.map((member) => {
              const isLeader = team.leader?.id === member.id

              return (
                <Item key={member.id} size="xs" variant="muted">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words">{member.name}</span>
                      {member.id === highlightUserId ? <Badge variant="outline">Você</Badge> : null}
                      {isLeader ? (
                        <Badge variant="secondary">
                          <CrownIcon data-icon="inline-start" />
                          Líder
                        </Badge>
                      ) : null}
                      {!member.active ? <Badge variant="outline">Acesso desativado</Badge> : null}
                    </ItemTitle>
                    <ItemDescription>{ROLE_LABELS[member.role]}</ItemDescription>
                  </ItemContent>
                  {canEdit ? (
                    <ItemActions>
                      <ConfirmDeleteButton
                        action={removeTeamMember.bind(null, team.id, member.id)}
                        label={`Retirar ${member.name} da equipe`}
                        title={`Retirar ${member.name} da ${team.name}?`}
                        description={
                          isLeader
                            ? "Esta pessoa é a líder: a equipe fica sem líder. Os números dela passam a contar só no total da imobiliária."
                            : "Os números desta pessoa passam a contar só no total da imobiliária, fora do subtotal da equipe."
                        }
                        confirmLabel="Retirar"
                      />
                    </ItemActions>
                  ) : null}
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>

      {canEdit ? (
        <CardFooter className="flex flex-wrap gap-2">
          <TeamAddMembersDialog teamId={team.id} teamName={team.name} candidates={addCandidates} />
          <TeamLeaderDialog
            teamId={team.id}
            teamName={team.name}
            currentLeaderId={team.leader?.id ?? null}
            options={leaderOptions}
          />
          <TeamFormDialog mode="rename" teamId={team.id} currentName={team.name} />
        </CardFooter>
      ) : null}
    </Card>
  )
}
