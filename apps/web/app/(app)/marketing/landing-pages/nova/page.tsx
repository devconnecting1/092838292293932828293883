import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon, LockIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

import { LandingTemplate } from "@/components/landing/landing-template"
import { PageHeading } from "@/components/crm/page-placeholder"
import { InertLeadForm } from "@/components/marketing/inert-lead-form"
import { TemplateGallery, type GalleryGroup } from "@/components/marketing/template-gallery"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { LANDING_SAMPLE_NOTICE, getLandingSamplePayload } from "@/lib/landing/sample-payloads"
import {
  LANDING_TEMPLATE_CATEGORY_LABELS,
  getLandingTemplatesByCategory,
  type LandingTemplateDefinition,
} from "@/lib/landing/templates"
import { LANDING_TEMPLATE_CATEGORIES, type LandingTemplateCategory } from "@/lib/landing/types"
import { LANDING_PAGES_PATH } from "@/lib/marketing/constants"
import { canEditLandingPages } from "@/lib/marketing/permissions"
import { maxPropertiesFor } from "@/lib/marketing/schemas"

export const metadata: Metadata = {
  title: "Nova página de captação",
}

const CATEGORY_DESCRIPTIONS: Record<LandingTemplateCategory, string> = {
  campanhas:
    "Para anúncios com um objetivo claro: agendar visita, pedir simulação ou captar proprietários.",
  lancamentos:
    "Para empreendimentos na planta: apresentação completa, lista VIP e tabela de unidades.",
  portfolio: "Para apresentar vários imóveis, a imobiliária ou um corretor.",
}

function propertiesLabel(template: LandingTemplateDefinition) {
  if (template.usesProperties === "none") return "Sem imóveis"
  if (template.usesProperties === "single") return "1 imóvel"
  return `Até ${maxPropertiesFor(template)} imóveis`
}

function imagesLabel(template: LandingTemplateDefinition) {
  const parts: string[] = []
  if (template.imageSlots.background) parts.push("Imagem de fundo")
  if (template.imageSlots.banners > 0) {
    parts.push(
      template.imageSlots.banners === 1 ? "1 banner" : `${template.imageSlots.banners} banners`
    )
  }
  return parts.length > 0 ? parts.join(" + ") : null
}

export default async function NewLandingPage() {
  const { membership } = await requireMembership()

  const heading = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <PageHeading
        title="Nova página de captação"
        description="Escolha um modelo. Depois você aplica cores, logo, textos e imóveis; a estrutura do modelo é fixa."
      />
      <Button variant="outline" render={<Link href={LANDING_PAGES_PATH} />} nativeButton={false}>
        <ArrowLeftIcon data-icon="inline-start" />
        Voltar
      </Button>
    </div>
  )

  if (!canEditLandingPages(membership.role)) {
    return (
      <PageShell>
        {heading}
        <Alert>
          <LockIcon />
          <AlertTitle>Sem permissão para criar páginas de captação</AlertTitle>
          <AlertDescription>
            Somente o dono, o gerente ou um assistente da imobiliária cria e edita páginas de
            captação.
          </AlertDescription>
        </Alert>
      </PageShell>
    )
  }

  const groups: GalleryGroup[] = LANDING_TEMPLATE_CATEGORIES.map((category) => ({
    category,
    label: LANDING_TEMPLATE_CATEGORY_LABELS[category],
    description: CATEGORY_DESCRIPTIONS[category],
    templates: getLandingTemplatesByCategory(category).map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
      bestFor: template.bestFor,
      propertiesLabel: propertiesLabel(template),
      imagesLabel: imagesLabel(template),
      preview: (
        <LandingTemplate
          mode="preview"
          payload={getLandingSamplePayload(template.key)}
          leadForm={<InertLeadForm idPrefix={`amostra-${template.key}`} />}
        />
      ),
    })),
  }))

  return (
    <PageShell>
      {heading}
      <p className="text-sm text-muted-foreground">{LANDING_SAMPLE_NOTICE}</p>
      <TemplateGallery groups={groups} />
    </PageShell>
  )
}
