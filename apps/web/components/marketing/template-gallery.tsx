"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { LandingPreviewFrame } from "@/components/marketing/landing-preview-frame"
import type { LandingTemplateKey } from "@/lib/landing/types"
import { createLandingPageAction } from "@/lib/marketing/actions"
import { landingEditorPath } from "@/lib/marketing/constants"

export type GalleryTemplate = {
  key: LandingTemplateKey
  name: string
  description: string
  bestFor: string
  propertiesLabel: string
  imagesLabel: string | null
  /** Modelo renderizado no servidor com o payload de exemplo. */
  preview: React.ReactNode
}

export type GalleryGroup = {
  category: string
  label: string
  description: string
  templates: GalleryTemplate[]
}

/**
 * Galeria dos modelos. A miniatura é o próprio modelo com dados de exemplo,
 * renderizado num iframe sem endereço (media queries de computador) e
 * reduzido para caber no cartão; não recebe cliques nem foco.
 */
export function TemplateGallery({ groups }: { groups: GalleryGroup[] }) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = React.useState<LandingTemplateKey | null>(null)
  const [, startTransition] = React.useTransition()

  function chooseTemplate(template: GalleryTemplate) {
    setPendingKey(template.key)

    startTransition(async () => {
      const result = await createLandingPageAction(template.key)

      if (!result.ok) {
        setPendingKey(null)
        toast.add({
          type: "error",
          title: "Não foi possível criar a página",
          description: result.error,
        })
        return
      }

      toast.add({
        type: "success",
        title: `Rascunho criado com o modelo ${template.name}.`,
      })
      router.push(landingEditorPath(result.id))
    })
  }

  return (
    <div className="flex flex-col gap-10">
      {groups.map((group) => (
        <section
          key={group.category}
          aria-labelledby={`galeria-${group.category}`}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 id={`galeria-${group.category}`} className="text-lg font-semibold tracking-tight">
              {group.label}
            </h2>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </div>

          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.templates.map((template) => {
              const isPending = pendingKey === template.key

              return (
                <li key={template.key}>
                  <Card className="h-full pt-0">
                    <div
                      inert
                      aria-hidden="true"
                      className="pointer-events-none relative aspect-4/3 w-full overflow-hidden border-b bg-muted select-none"
                    >
                      <LandingPreviewFrame
                        device="desktop"
                        fit="clip"
                        title={`Miniatura do modelo ${template.name}`}
                      >
                        {template.preview}
                      </LandingPreviewFrame>
                    </div>
                    <CardHeader>
                      <CardTitle>{template.name}</CardTitle>
                      <CardDescription>{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-3">
                      <p className="text-sm">
                        <span className="font-medium">Ideal para:</span> {template.bestFor}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary">{template.propertiesLabel}</Badge>
                        {template.imagesLabel ? (
                          <Badge variant="outline">{template.imagesLabel}</Badge>
                        ) : null}
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        disabled={pendingKey !== null}
                        onClick={() => chooseTemplate(template)}
                      >
                        {isPending ? <Spinner data-icon="inline-start" /> : null}
                        {isPending ? "Criando rascunho..." : "Usar este modelo"}
                        {isPending ? null : <ArrowRightIcon data-icon="inline-end" />}
                      </Button>
                    </CardFooter>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
