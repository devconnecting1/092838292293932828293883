import type { Metadata } from "next"

import { APP_NAME } from "@/components/crm/brand"
import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { isSupabaseConfigured } from "@/lib/supabase/env"

export const metadata: Metadata = {
  title: {
    template: `%s · ${APP_NAME}`,
    default: APP_NAME,
  },
  // Links de convite carregam um token: nunca indexar.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default function ConviteLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  return <div className="flex min-h-svh flex-col bg-muted/40">{children}</div>
}
