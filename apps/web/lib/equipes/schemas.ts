import { z } from "zod"

import { normalizeTeamName, TEAM_NAME_MAX_LENGTH } from "@workspace/core/teams/rules"

import { TEAM_ADD_MEMBERS_MAX } from "@/lib/equipes/constants"

// Schemas usados pelo formulário (cliente) e revalidados na Server Action.

const idField = (message: string) => z.guid(message)

/** A action grava o nome já normalizado (normalizeTeamName: espaços repetidos viram um). */
export const teamNameField = z
  .string()
  .refine((value) => normalizeTeamName(value).length > 0, "Dê um nome para a equipe.")
  .refine(
    (value) => normalizeTeamName(value).length <= TEAM_NAME_MAX_LENGTH,
    `Use no máximo ${TEAM_NAME_MAX_LENGTH} caracteres.`
  )

export const createTeamSchema = z.object({
  name: teamNameField,
  /** Vazio = sem líder por enquanto. */
  leaderId: z.union([z.literal(""), idField("Escolha um líder da lista.")]),
})

export type CreateTeamValues = z.infer<typeof createTeamSchema>

export const renameTeamSchema = z.object({
  teamId: idField("Equipe inválida."),
  name: teamNameField,
})

export type RenameTeamValues = z.infer<typeof renameTeamSchema>

export const setTeamLeaderSchema = z.object({
  teamId: idField("Equipe inválida."),
  /** Vazio = equipe sem líder. */
  leaderId: z.union([z.literal(""), idField("Escolha um líder da lista.")]),
})

export type SetTeamLeaderValues = z.infer<typeof setTeamLeaderSchema>

export const addTeamMembersSchema = z.object({
  teamId: idField("Equipe inválida."),
  userIds: z
    .array(idField("Pessoa inválida."))
    .min(1, "Marque pelo menos uma pessoa.")
    .max(TEAM_ADD_MEMBERS_MAX, `Inclua no máximo ${TEAM_ADD_MEMBERS_MAX} pessoas de uma vez.`),
})

export type AddTeamMembersValues = z.infer<typeof addTeamMembersSchema>

export const teamMemberRefSchema = z.object({
  teamId: idField("Equipe inválida."),
  userId: idField("Pessoa inválida."),
})

export const teamIdSchema = idField("Equipe inválida.")
