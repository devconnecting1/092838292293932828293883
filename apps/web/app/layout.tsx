// Geist oficial da Vercel (pacote `geist`, woff2 variável servido pelo próprio app via
// next/font/local): nenhuma requisição ao Google, nem no build nem no navegador.
import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "@workspace/ui/globals.css"
import { DirectionProvider } from "@workspace/ui/components/direction"
import { APP_NAME } from "@/components/crm/brand"
import { VercelObservability } from "@/components/vercel-observability"
import { cn } from "@workspace/ui/lib/utils"

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    template: `%s · ${APP_NAME}`,
    default: APP_NAME,
  },
  description:
    "CRM para corretores e imobiliárias: imóveis, clientes, funil de leads, agenda, propostas e landing pages num só lugar.",
}

// Web Analytics e Speed Insights da Vercel só no build de produção. Os scripts vêm do
// próprio domínio (/_vercel/...) e só respondem na Vercel com os recursos ativados no painel.
const enableVercelObservability = process.env.NODE_ENV === "production"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="pt-BR"
      dir="ltr"
      suppressHydrationWarning
      className={cn("antialiased", "font-sans", GeistSans.variable, GeistMono.variable)}
    >
      {/* Extensões como ColorZilla injetam atributos no body antes da hidratação. */}
      <body suppressHydrationWarning>
        <DirectionProvider direction="ltr">{children}</DirectionProvider>
        {enableVercelObservability ? <VercelObservability /> : null}
      </body>
    </html>
  )
}
