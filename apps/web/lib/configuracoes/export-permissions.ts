import { z } from "zod"

import { ROLE_LABELS, ROLES, isRole, type Role } from "@/lib/auth/roles"

/**
 * Quem pode exportar CSV (relatórios e base) — espelho, para a interface, de
 * `private.can_export_data` (migração `export_permissions_and_owner_privacy`).
 *
 * O dono escolhe os papéis em /configuracoes/permissoes; sem configuração,
 * valem dono e gerente. O dono sempre exporta. Esconder o botão aqui é só
 * conforto: a rota responde 403 e as RPCs de exportação recusam a página sem
 * uma exportação registrada e permitida.
 *
 * Arquivo puro: serve no servidor e no formulário do navegador.
 */

export const DEFAULT_EXPORT_ROLES: readonly Role[] = ["owner", "manager"]

/** Papéis que o dono pode ligar ou desligar (o dono fica sempre ligado). */
export const CONFIGURABLE_EXPORT_ROLES: readonly Role[] = ROLES.filter((role) => role !== "owner")

/** Lista vinda do banco ou do formulário: só papéis válidos, sem repetir, com o dono. */
export function normalizeExportRoles(value: unknown): Role[] {
  const roles = new Set<Role>(["owner"])

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRole(item)) roles.add(item)
    }
  }

  return ROLES.filter((role) => roles.has(role))
}

export function canExportData(role: Role, exportRoles: readonly Role[]) {
  return role === "owner" || exportRoles.includes(role)
}

/** "Dono, Gerente e Corretor". */
export function exportRolesLabel(exportRoles: readonly Role[]) {
  const labels = normalizeExportRoles(exportRoles).map((role) => ROLE_LABELS[role])
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
}

/** Resposta da rota e aviso na tela para quem não exporta. */
export function exportDeniedMessage(exportRoles: readonly Role[]) {
  const allowed = normalizeExportRoles(exportRoles)
  const verb = allowed.length === 1 ? "exporta" : "exportam"

  return `Seu papel não exporta dados nesta imobiliária. Hoje ${verb}: ${exportRolesLabel(allowed)}. Quem libera é o dono, em Configurações > Papéis e permissões.`
}

export const exportRolesFormSchema = z.object({
  roles: z
    .array(
      z.custom<Role>(
        (value) => isRole(value) && value !== "owner",
        "Papel inválido para a exportação."
      )
    )
    .max(CONFIGURABLE_EXPORT_ROLES.length),
})

export type ExportRolesFormValues = z.infer<typeof exportRolesFormSchema>
