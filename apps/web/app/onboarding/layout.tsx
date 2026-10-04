import type { Metadata } from "next"

import { APP_NAME } from "@/components/crm/brand"
import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { isSupabaseConfigured } from "@/lib/supabase/env"

export const metadata: Metadata = {
  title: {
    template: `%s · ${APP_NAME}`,
    default: APP_NAME,
  },
}

export default function OnboardingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  return children
}
