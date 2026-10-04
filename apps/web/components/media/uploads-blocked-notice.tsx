import Link from "next/link"
import { LockIcon } from "lucide-react"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { cn } from "@workspace/ui/lib/utils"

import { SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"
import { UPLOADS_BLOCKED_MESSAGE } from "@/lib/media/upload-errors"

/** Aviso de upload bloqueado pela assinatura em modo leitura. */
export function UploadsBlockedNotice({
  compact = false,
  className,
}: {
  /** Uma linha de texto (campos do editor de landing page). */
  compact?: boolean
  className?: string
}) {
  if (compact) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} role="status">
        {UPLOADS_BLOCKED_MESSAGE}{" "}
        <Link
          href={SUBSCRIPTION_SETTINGS_PATH}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Ver assinatura
        </Link>
      </p>
    )
  }

  return (
    <Alert className={className} role="status">
      <LockIcon />
      <AlertDescription>
        <p>
          {UPLOADS_BLOCKED_MESSAGE}{" "}
          <Link
            href={SUBSCRIPTION_SETTINGS_PATH}
            className="font-medium underline underline-offset-4"
          >
            Ver assinatura
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}
