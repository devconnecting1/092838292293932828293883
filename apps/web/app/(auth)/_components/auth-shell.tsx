import Link from "next/link"

import { AuthCover } from "@/app/(auth)/_components/auth-cover"
import { BrandLogo } from "@/components/crm/brand"
import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { getStatusPageHref } from "@/components/status/links"
import { isSupabaseConfigured } from "@/lib/supabase/env"

/** Moldura das telas de autenticação (grupo (auth) e /auth/confirmar). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <main className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/">
            <BrandLogo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
        {/* Link discreto: quem não consegue entrar confere se o sistema está com problema. */}
        <footer className="flex justify-center text-xs text-muted-foreground md:justify-start">
          <a
            href={getStatusPageHref()}
            className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Status do sistema
          </a>
        </footer>
      </main>
      <AuthCover />
    </div>
  )
}
