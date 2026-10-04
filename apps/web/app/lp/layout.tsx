import type { Metadata } from "next"

/**
 * Página pública, sem login: não oferece o manifesto do CRM (app/manifest.ts),
 * para "Adicionar à tela de início" não instalar o CRM a partir dela.
 */
export const metadata: Metadata = {
  manifest: null,
}

/**
 * Landing pages públicas (/lp/[org]/[page]): sem a casca do CRM, sem sidebar e
 * sem exigir login. `lang="pt-BR"` vem do layout raiz.
 */
export default function LandingPagesLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <div className="min-h-svh bg-background text-foreground">{children}</div>
}
