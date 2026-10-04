import { SettingsFrame } from "@/components/shared/settings-nav"
import { requireMembership } from "@/lib/auth/session"

/**
 * Casca das configurações: sub-navegação vertical (faixa no topo no celular) em
 * volta das subpáginas. O índice /configuracoes fica sem sub-navegação.
 */
export default async function ConfiguracoesLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { membership } = await requireMembership()

  return <SettingsFrame role={membership.role}>{children}</SettingsFrame>
}
