import type { Metadata } from "next"
import { InfoIcon, UsersRoundIcon } from "lucide-react"

import {
  checkAddMember,
  leaderCandidates,
  membersWithoutTeam,
  teamIdOf,
} from "@workspace/core/teams/rules"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
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

import { PageHeading } from "@/components/crm/page-placeholder"
import type { AddMemberCandidate } from "@/components/equipes/team-add-members-dialog"
import { TeamCard, type TeamCardData } from "@/components/equipes/team-card"
import { TeamFormDialog } from "@/components/equipes/team-form-dialog"
import { LeaderVisibilityCard } from "@/components/equipes/leader-visibility-card"
import { PageShell } from "@/components/shared/page-shell"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { canEditTeams } from "@/lib/equipes/constants"
import { getTeamsData, type TeamPerson } from "@/lib/equipes/queries"

export const metadata: Metadata = {
  title: "Equipes comerciais",
}

/**
 * Equipes comerciais. Todo membro abre (o nome da equipe e quem está nela não é
 * dado sensível — RLS "teams: membros leem"), mas só dono e gerente montam; os
 * demais veem só as equipes em que estão ou que lideram.
 */
export default async function EquipesPage() {
  const { user, membership } = await requireMembership()
  const canEdit = canEditTeams(membership.role)
  const { teams, teamMembers, people } = await getTeamsData(membership.organizationId)

  const personById = new Map(people.map((person) => [person.id, person]))
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const context = { teams, teamMembers, members: people }

  const visibleTeams = canEdit
    ? teams
    : teams.filter(
        (team) => team.leaderId === user.id || teamIdOf(user.id, teamMembers) === team.id
      )

  const cards: TeamCardData[] = visibleTeams.map((team) => ({
    id: team.id,
    name: team.name,
    leader: team.leaderId ? (personById.get(team.leaderId) ?? null) : null,
    members: teamMembers
      .filter((member) => member.teamId === team.id)
      .map((member) => personById.get(member.userId))
      .filter((person): person is TeamPerson => Boolean(person)),
  }))

  const withoutTeam = membersWithoutTeam(people, teamMembers)
  const newTeamLeaderOptions = withoutTeam

  function addCandidatesFor(teamId: string): AddMemberCandidate[] {
    return people
      .filter((person) => person.active && teamIdOf(person.id, teamMembers) !== teamId)
      .map((person) => {
        const check = checkAddMember(teamId, person.id, context)
        const currentTeamId = teamIdOf(person.id, teamMembers)

        return {
          id: person.id,
          name: person.name,
          role: person.role,
          currentTeamName: currentTeamId ? (teamById.get(currentTeamId)?.name ?? null) : null,
          leadsTeamName:
            !check.ok && check.problem === "leads_other_team"
              ? (teamById.get(check.teamId)?.name ?? "outra equipe")
              : null,
        }
      })
  }

  const heading = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <PageHeading
        title="Equipes comerciais"
        description="Agrupe os corretores em equipes com um líder para ver subtotais e metas por equipe nos relatórios."
      />
      {canEdit && teams.length > 0 ? (
        <TeamFormDialog mode="create" leaderOptions={newTeamLeaderOptions} />
      ) : null}
    </div>
  )

  return (
    <PageShell variant="settings" width="wide" header={heading}>
      {!canEdit ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Só o dono e o gerente montam as equipes</AlertTitle>
          <AlertDescription>
            {visibleTeams.length > 0
              ? "Aqui aparece a equipe em que você está ou que você lidera."
              : "Você ainda não está em nenhuma equipe. Peça à gestão para incluir você."}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <InfoIcon />
          <AlertTitle>Como as equipes contam nos relatórios</AlertTitle>
          <AlertDescription>
            Cada pessoa fica em no máximo uma equipe. Quem não está em equipe conta só no total da
            imobiliária. O subtotal usa a equipe de agora: ao mudar alguém de equipe, os números dos
            meses anteriores dessa pessoa vão junto.
          </AlertDescription>
        </Alert>
      )}

      {cards.length === 0 ? (
        canEdit ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersRoundIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma equipe criada</EmptyTitle>
              <EmptyDescription>
                Crie a primeira equipe, escolha o líder e inclua os corretores. Enquanto não houver
                equipe, os relatórios mostram só o total da imobiliária e cada corretor.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <TeamFormDialog
                mode="create"
                leaderOptions={newTeamLeaderOptions}
                triggerLabel="Criar a primeira equipe"
              />
            </EmptyContent>
          </Empty>
        ) : null
      ) : (
        <div className="grid gap-4 @min-[64rem]/page:grid-cols-2">
          {cards.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              canEdit={canEdit}
              highlightUserId={user.id}
              leaderOptions={
                canEdit ? leaderCandidates(team.id, { members: people, teamMembers }) : []
              }
              addCandidates={canEdit ? addCandidatesFor(team.id) : []}
            />
          ))}
        </div>
      )}

      {canEdit && teams.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sem equipe</CardTitle>
            <CardDescription>
              Pessoas ativas fora de qualquer equipe. Os números delas aparecem no total da
              imobiliária e em cada corretor, mas não em subtotal de equipe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {withoutTeam.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todas as pessoas ativas têm equipe.</p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="Pessoas sem equipe">
                {withoutTeam.map((person) => (
                  <li key={person.id}>
                    <Badge variant="outline">
                      {person.name} · {ROLE_LABELS[person.role]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <LeaderVisibilityCard />
    </PageShell>
  )
}
