import type { Metadata } from "next"
import Link from "next/link"
import { RssIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { APP_NAME, BrandLogo } from "@/components/crm/brand"
import { SupportHelpButton } from "@/components/crm/support-help-button"
import { STATUS_FEED_PATH, tryBuildStatusUrl } from "@/components/status/links"
import { LOGIN_PATH } from "@/lib/auth/routes"

import "@/components/status/status-colors.css"

// URL absoluta do feed (sem metadataBase no app, um caminho relativo viraria localhost).
const feedUrl = tryBuildStatusUrl(STATUS_FEED_PATH)

/**
 * Página pública, sem login e indexável (clientes procuram "status" no
 * buscador). Não oferece o manifesto do CRM (app/manifest.ts), para
 * "Adicionar à tela de início" não instalar o CRM a partir dela.
 */
export const metadata: Metadata = {
  manifest: null,
  robots: { index: true, follow: true },
  alternates: feedUrl
    ? {
        types: {
          "application/rss+xml": [
            { url: feedUrl, title: `Incidentes e manutenções · ${APP_NAME}` },
          ],
        },
      }
    : undefined,
}

/**
 * Moldura da página de status: sem a casca do CRM e sem depender do Supabase
 * configurado (sem dados, a página diz que não conseguiu verificar). Nada de
 * fonte, imagem ou script de terceiros.
 */
export default function StatusLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#conteudo"
        className="sr-only rounded-lg bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:inset-s-4 focus:top-4 focus:ring-3 focus:ring-ring/50"
      >
        Pular para o conteúdo
      </a>

      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" aria-label={`${APP_NAME}: página inicial`} className="rounded-md">
            <BrandLogo />
          </Link>
          <nav aria-label="Acesso" className="flex items-center gap-2">
            <SupportHelpButton variant="ghost" />
            <Button variant="outline" render={<Link href={LOGIN_PATH} />} nativeButton={false}>
              Entrar
            </Button>
          </nav>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:py-10">
          {children}
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="text-pretty">
            Checagem automática a cada minuto e atualizações escritas pela equipe durante
            incidentes. Horários de Brasília.
          </p>
          <a
            href={STATUS_FEED_PATH}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <RssIcon aria-hidden className="size-4" />
            Feed RSS dos incidentes
          </a>
        </div>
      </footer>
    </div>
  )
}
