import Link from "next/link"
import { ShieldAlertIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

type ClientAccessDeniedProps = {
  title: string
  description: string
  backHref: string
  backLabel?: string
}

export function ClientAccessDenied({
  title,
  description,
  backHref,
  backLabel = "Voltar",
}: ClientAccessDeniedProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 lg:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={backHref} />} nativeButton={false}>
            {backLabel}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
