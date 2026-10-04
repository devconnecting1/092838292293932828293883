import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@workspace/core/platform/staff"
import { Badge } from "@workspace/ui/components/badge"

const VARIANTS: Record<PlatformRole, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  viewer: "outline",
}

/** Papel na equipe da plataforma: Dono, Administrador ou Somente leitura. */
export function PlatformRoleBadge({ role }: { role: PlatformRole }) {
  return <Badge variant={VARIANTS[role]}>{PLATFORM_ROLE_LABELS[role]}</Badge>
}
