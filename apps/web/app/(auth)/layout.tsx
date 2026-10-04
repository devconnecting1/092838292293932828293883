import type { Metadata } from "next"

import { AuthShell } from "@/app/(auth)/_components/auth-shell"
import { APP_NAME } from "@/components/crm/brand"

export const metadata: Metadata = {
  title: {
    template: `%s · ${APP_NAME}`,
    default: APP_NAME,
  },
}

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <AuthShell>{children}</AuthShell>
}
