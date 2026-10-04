import Link from "next/link"
import { LayoutTemplateIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { LANDING_PAGES_PATH } from "@/lib/marketing/constants"

export default function LandingPageNotFound() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutTemplateIcon />
          </EmptyMedia>
          <EmptyTitle>Página de captação não encontrada</EmptyTitle>
          <EmptyDescription>
            Ela pode ter sido removida ou pertence a outra imobiliária. Confira a imobiliária
            selecionada no menu.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            render={<Link href={LANDING_PAGES_PATH} />}
            nativeButton={false}
          >
            Ver páginas de captação
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
