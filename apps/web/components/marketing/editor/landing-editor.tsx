"use client"

import * as React from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ClipboardListIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MonitorIcon,
  SendIcon,
  SmartphoneIcon,
} from "lucide-react"
import { useForm, useWatch, type FieldPath } from "react-hook-form"
import { z } from "zod"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { FieldDescription } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { LandingTemplate } from "@/components/landing/landing-template"
import { ContentSection } from "@/components/marketing/editor/content-section"
import { IdentitySection } from "@/components/marketing/editor/identity-section"
import { LeadsSection } from "@/components/marketing/editor/leads-section"
import { PropertyPicker } from "@/components/marketing/editor/property-picker"
import { PublicationSection } from "@/components/marketing/editor/publication-section"
import { SaveStatus, type SaveStatusState } from "@/components/marketing/editor/save-status"
import {
  LANDING_EDITOR_SECTION_LABELS,
  type LandingEditorFormValues,
  type LandingEditorSection,
} from "@/components/marketing/editor/types"
import { InertLeadForm } from "@/components/marketing/inert-lead-form"
import {
  LandingPreviewFrame,
  type PreviewDevice,
} from "@/components/marketing/landing-preview-frame"
import { LandingStatusBadge } from "@/components/marketing/landing-status-badge"
import { PageShell } from "@/components/shared/page-shell"
import { LANDING_TEMPLATE_CATEGORY_LABELS, getLandingTemplate } from "@/lib/landing/templates"
import type { LandingOrganization, LandingTemplateKey } from "@/lib/landing/types"
import {
  saveLandingContentAction,
  saveLandingIdentityAction,
  saveLandingLeadsAction,
  saveLandingPropertiesAction,
  saveLandingPublicationAction,
  setLandingStatusAction,
  type LandingActionResult,
} from "@/lib/marketing/actions"
import {
  AUTOSAVE_DELAY_MS,
  LANDING_PAGES_PATH,
  landingPreviewPath,
  type LandingStatus,
} from "@/lib/marketing/constants"
import {
  buildPreviewPayload,
  type LandingMemberOption,
  type LandingPropertySnapshot,
} from "@/lib/marketing/payload"
import {
  buildContentSchema,
  contentValuesToContent,
  getPublishIssues,
  identitySchema,
  identityValuesToTheme,
  maxPropertiesFor,
  publicationSchema,
  publicationValuesToColumns,
} from "@/lib/marketing/schemas"

const SECTION_ORDER: readonly LandingEditorSection[] = [
  "identity",
  "content",
  "properties",
  "leads",
  "publication",
]

type Snapshot = Record<LandingEditorSection, string>

type SectionFailure = { snapshot: string; message: string; invalid: boolean }

type SaveInput = {
  values: LandingEditorFormValues
  propertyIds: string[]
  leadAssigneeId: string | null
}

function serializeSections({ values, propertyIds, leadAssigneeId }: SaveInput): Snapshot {
  return {
    identity: JSON.stringify(values.identity),
    content: JSON.stringify(values.content),
    publication: JSON.stringify(values.publication),
    properties: JSON.stringify(propertyIds),
    leads: leadAssigneeId ?? "",
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const STATUS_CONFIRM: Record<
  LandingStatus,
  { title: string; description: string; action: string }
> = {
  published: {
    title: "Publicar a página de captação?",
    description:
      "A página fica no ar no endereço público e cada contato enviado vira um lead no funil.",
    action: "Publicar",
  },
  draft: {
    title: "Tirar a página do ar?",
    description:
      "O endereço público deixa de abrir e a página volta a ser rascunho. Os leads recebidos continuam no funil.",
    action: "Despublicar",
  },
  archived: {
    title: "Arquivar a página de captação?",
    description: "A página sai do ar e vai para a lista de arquivadas.",
    action: "Arquivar",
  },
}

export type LandingEditorProps = {
  page: {
    id: string
    organizationId: string
    template: LandingTemplateKey
    status: LandingStatus
    publishedAt: string | null
  }
  initialValues: LandingEditorFormValues
  initialProperties: LandingPropertySnapshot[]
  /** Ids gravados (podem incluir imóveis removidos, que saem no próximo salvamento). */
  initialPropertyIds: string[]
  initialLeadAssigneeId: string | null
  members: LandingMemberOption[]
  organization: LandingOrganization
  organizationSlug: string
  canEdit: boolean
  /** Assinatura em modo leitura: o Storage recusa novas imagens. */
  uploadsBlocked?: boolean
}

export function LandingEditor({
  page,
  initialValues,
  initialProperties,
  initialPropertyIds,
  initialLeadAssigneeId,
  members,
  organization,
  organizationSlug,
  canEdit,
  uploadsBlocked = false,
}: LandingEditorProps) {
  const template = getLandingTemplate(page.template)
  const schema = React.useMemo(
    () =>
      z.object({
        identity: identitySchema,
        content: buildContentSchema(template),
        publication: publicationSchema,
      }),
    [template]
  )

  const form = useForm<LandingEditorFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: "onChange",
  })

  const watched = useWatch({ control: form.control }) as LandingEditorFormValues
  const [properties, setProperties] = React.useState(initialProperties)
  const [leadAssigneeId, setLeadAssigneeId] = React.useState(initialLeadAssigneeId)
  const [status, setStatus] = React.useState(page.status)
  const [publishedAt, setPublishedAt] = React.useState(page.publishedAt)
  const [device, setDevice] = React.useState<PreviewDevice>("desktop")
  const [mobileView, setMobileView] = React.useState<"editar" | "visualizar">("editar")
  const [openSections, setOpenSections] = React.useState<string[]>(["identity", "content"])

  const [saved, setSaved] = React.useState<Snapshot>(() =>
    serializeSections({
      values: initialValues,
      propertyIds: initialPropertyIds,
      leadAssigneeId: initialLeadAssigneeId,
    })
  )
  const [failures, setFailures] = React.useState<
    Partial<Record<LandingEditorSection, SectionFailure>>
  >({})
  const [isSaving, setIsSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const [leadsError, setLeadsError] = React.useState<string | null>(null)
  const [propertiesError, setPropertiesError] = React.useState<string | null>(null)
  const [saveTick, setSaveTick] = React.useState(0)

  const [confirmStatus, setConfirmStatus] = React.useState<LandingStatus | null>(null)
  const [issuesOpen, setIssuesOpen] = React.useState(false)
  const [serverIssues, setServerIssues] = React.useState<string[] | null>(null)
  const [isChangingStatus, startStatusChange] = React.useTransition()

  const savingRef = React.useRef(false)
  const queuedRef = React.useRef(false)

  const propertyIds = properties.map((property) => property.id)
  const current = serializeSections({
    values: watched,
    propertyIds,
    leadAssigneeId,
  })
  const dirty = SECTION_ORDER.filter((section) => current[section] !== saved[section])
  const retryable = dirty.filter((section) => failures[section]?.snapshot !== current[section])
  const dirtyKey = retryable.map((section) => `${section}:${current[section]}`).join("|")

  const latestRef = React.useRef({
    propertyIds,
    leadAssigneeId,
    retryable,
    dirty,
  })
  React.useEffect(() => {
    latestRef.current = { propertyIds, leadAssigneeId, retryable, dirty }
  })

  const flush = React.useCallback(
    async (sections: readonly LandingEditorSection[], input: SaveInput): Promise<boolean> => {
      if (sections.length === 0) return true
      if (savingRef.current) {
        queuedRef.current = true
        return false
      }

      savingRef.current = true
      setIsSaving(true)

      const serialized = serializeSections(input)
      let allSaved = true
      let anySaved = false
      const toOpen: LandingEditorSection[] = []

      for (const section of sections) {
        if (section === "identity" || section === "content" || section === "publication") {
          const valid = await form.trigger(section)
          if (!valid) {
            allSaved = false
            toOpen.push(section)
            setFailures((previous) => ({
              ...previous,
              [section]: {
                snapshot: serialized[section],
                message: "Corrija os campos destacados.",
                invalid: true,
              },
            }))
            continue
          }
        }

        let result: LandingActionResult
        try {
          switch (section) {
            case "identity":
              result = await saveLandingIdentityAction(page.id, input.values.identity)
              break
            case "content":
              result = await saveLandingContentAction(page.id, input.values.content)
              break
            case "publication":
              result = await saveLandingPublicationAction(page.id, input.values.publication)
              break
            case "properties":
              result = await saveLandingPropertiesAction(page.id, input.propertyIds)
              break
            case "leads":
              result = await saveLandingLeadsAction(page.id, input.leadAssigneeId)
              break
          }
        } catch {
          result = {
            ok: false,
            error: "Sem conexão com o servidor. Confira a internet e tente de novo.",
          }
        }

        if (result.ok) {
          anySaved = true
          setSaved((previous) => ({
            ...previous,
            [section]: serialized[section],
          }))
          setFailures((previous) => {
            const next = { ...previous }
            delete next[section]
            return next
          })
          if (section === "leads") setLeadsError(null)
          if (section === "properties") setPropertiesError(null)
          continue
        }

        allSaved = false
        const fieldErrors = result.fieldErrors ?? {}
        const hasFieldErrors = Object.keys(fieldErrors).length > 0
        if (hasFieldErrors) toOpen.push(section)

        setFailures((previous) => ({
          ...previous,
          [section]: {
            snapshot: serialized[section],
            message: result.error,
            invalid: hasFieldErrors,
          },
        }))

        if (section === "leads") {
          setLeadsError(fieldErrors.leadAssigneeId ?? result.error)
        } else if (section === "properties") {
          setPropertiesError(result.error)
        } else {
          for (const [key, message] of Object.entries(fieldErrors)) {
            form.setError(`${section}.${key}` as FieldPath<LandingEditorFormValues>, {
              type: "server",
              message,
            })
          }
        }
      }

      if (toOpen.length > 0) {
        setOpenSections((previous) => [...new Set([...previous, ...toOpen])])
      }
      if (anySaved) setSavedAt(new Date().toISOString())

      savingRef.current = false
      setIsSaving(false)

      if (queuedRef.current) {
        queuedRef.current = false
        setSaveTick((tick) => tick + 1)
      }

      return allSaved
    },
    [form, page.id]
  )

  // Salvamento automático: espera o usuário parar de editar e salva só as seções alteradas.
  React.useEffect(() => {
    if (!canEdit || !dirtyKey) return

    const timer = setTimeout(() => {
      const latest = latestRef.current
      void flush(latest.retryable, {
        values: form.getValues(),
        propertyIds: latest.propertyIds,
        leadAssigneeId: latest.leadAssigneeId,
      })
    }, AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [canEdit, dirtyKey, saveTick, flush, form])

  const hasUnsavedChanges = canEdit && (dirty.length > 0 || isSaving)

  React.useEffect(() => {
    if (!hasUnsavedChanges) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [hasUnsavedChanges])

  // ---------------------------------------------------------------------------
  // Pré-visualização
  // ---------------------------------------------------------------------------

  const deferredValues = React.useDeferredValue(watched)
  const deferredProperties = React.useDeferredValue(properties)
  const deferredAssignee = React.useDeferredValue(leadAssigneeId)

  const payload = React.useMemo(
    () =>
      buildPreviewPayload({
        draft: {
          id: page.id,
          template: page.template,
          name: deferredValues.publication.name,
          slug: deferredValues.publication.slug,
          theme: identityValuesToTheme(deferredValues.identity, template),
          content: contentValuesToContent(deferredValues.content, template),
          tracking: {},
          seo: publicationValuesToColumns(deferredValues.publication).seo,
          publishedAt,
        },
        organization,
        properties: deferredProperties,
        broker: members.find((member) => member.id === deferredAssignee)?.broker ?? null,
      }),
    [
      deferredAssignee,
      deferredProperties,
      deferredValues,
      members,
      organization,
      page.id,
      page.template,
      publishedAt,
      template,
    ]
  )

  // ---------------------------------------------------------------------------
  // Publicação
  // ---------------------------------------------------------------------------

  const activePropertyCount = properties.filter((property) => property.status === "active").length
  const publishIssues = getPublishIssues({
    template,
    content: contentValuesToContent(watched.content, template),
    seo: publicationValuesToColumns(watched.publication).seo,
    activePropertyCount,
  })
  const shownIssues = serverIssues ?? publishIssues

  function requestStatus(next: LandingStatus) {
    if (next === "published" && publishIssues.length > 0) {
      setServerIssues(null)
      setIssuesOpen(true)
      return
    }
    setConfirmStatus(next)
  }

  function runStatusChange() {
    const next = confirmStatus
    if (!next) return

    startStatusChange(async () => {
      // Termina o salvamento em andamento e grava o que falta antes de mudar o status.
      // Até 30 s: as seções são salvas uma a uma e a conexão pode estar lenta.
      for (let attempt = 0; attempt < 300 && savingRef.current; attempt += 1) {
        await wait(100)
      }

      const latest = latestRef.current
      if (latest.dirty.length > 0) {
        const ok = await flush(latest.dirty, {
          values: form.getValues(),
          propertyIds: latest.propertyIds,
          leadAssigneeId: latest.leadAssigneeId,
        })

        if (!ok) {
          setConfirmStatus(null)
          toast.add({
            type: "error",
            title: "Não foi possível salvar as alterações",
            description: "Corrija os campos destacados e tente de novo.",
          })
          return
        }
      }

      const result = await setLandingStatusAction(page.id, next)
      setConfirmStatus(null)

      if (!result.ok) {
        if (result.issues?.length) {
          setServerIssues(result.issues)
          setIssuesOpen(true)
        } else {
          toast.add({
            type: "error",
            title: "Não foi possível alterar o status",
            description: result.error,
          })
        }
        return
      }

      setStatus(result.status)
      setPublishedAt(result.publishedAt)
      toast.add({ type: "success", title: result.message })
    })
  }

  const saveState: SaveStatusState = (() => {
    if (!canEdit) return { kind: "readonly" }
    if (isSaving) return { kind: "saving" }
    const invalid = dirty.filter(
      (section) => failures[section]?.invalid && failures[section]?.snapshot === current[section]
    )
    if (invalid.length > 0) {
      return {
        kind: "invalid",
        sections: invalid.map((section) => LANDING_EDITOR_SECTION_LABELS[section]),
      }
    }
    const failed = dirty.find(
      (section) => failures[section] && failures[section]?.snapshot === current[section]
    )
    if (failed)
      return {
        kind: "error",
        message: failures[failed]?.message ?? "Tente novamente.",
      }
    if (dirty.length > 0) return { kind: "pending" }
    return { kind: "saved", at: savedAt }
  })()

  const uploadTarget = { organizationId: page.organizationId, pageId: page.id, uploadsBlocked }
  const disabled = !canEdit
  const confirmCopy = confirmStatus ? STATUS_CONFIRM[confirmStatus] : null
  const maxProperties = maxPropertiesFor(template)
  const fallbackShareImagePath =
    watched.identity.backgroundPath ?? watched.identity.bannerPaths[0] ?? null

  return (
    // Tela cheia: sem gutter lateral na raiz; cada faixa define o seu e a prévia encosta na borda.
    <PageShell bleed>
      <header className="flex flex-col gap-3 px-4 lg:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={LANDING_PAGES_PATH} />}
            nativeButton={false}
          >
            <ArrowLeftIcon />
            <span className="sr-only">Voltar para as páginas de captação</span>
          </Button>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {watched.publication.name || "Página de captação"}
              </h1>
              <LandingStatusBadge status={status} />
            </div>
            <p className="text-sm text-muted-foreground">
              Modelo {template.name} · {LANDING_TEMPLATE_CATEGORY_LABELS[template.category]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SaveStatus state={saveState} onRetry={() => setFailures({})} />
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={landingPreviewPath(page.id)} target="_blank" rel="noopener noreferrer" />
            }
            nativeButton={false}
          >
            <EyeIcon data-icon="inline-start" />
            Tela cheia
          </Button>
          {canEdit && status === "published" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isChangingStatus}
              onClick={() => requestStatus("draft")}
            >
              <EyeOffIcon data-icon="inline-start" />
              Despublicar
            </Button>
          ) : null}
          {canEdit && status === "archived" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isChangingStatus}
              onClick={() => requestStatus("draft")}
            >
              <ArchiveRestoreIcon data-icon="inline-start" />
              Restaurar
            </Button>
          ) : null}
          {canEdit && status === "draft" ? (
            <Button
              size="sm"
              disabled={isChangingStatus}
              onClick={() => requestStatus("published")}
            >
              {isChangingStatus ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              Publicar
            </Button>
          ) : null}
        </div>
      </header>

      {!canEdit ? (
        <div className="px-4 lg:px-6">
          <Alert>
            <LockIcon />
            <AlertTitle>Somente leitura</AlertTitle>
            <AlertDescription>
              Seu papel permite ver a configuração. Para editar, peça ao dono, ao gerente ou a um
              assistente.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Tabs
        value={mobileView}
        onValueChange={(value) => setMobileView(value === "visualizar" ? "visualizar" : "editar")}
        className="px-4 lg:hidden"
      >
        <TabsList className="w-full">
          <TabsTrigger value="editar">Editar</TabsTrigger>
          <TabsTrigger value="visualizar">Visualizar</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid flex-1 items-start gap-6 px-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:ps-6 lg:pe-0">
        <div
          className={cn(
            "min-w-0 flex-col gap-4",
            mobileView === "editar" ? "flex" : "hidden lg:flex"
          )}
        >
          {canEdit && status === "draft" && publishIssues.length > 0 ? (
            <Alert>
              <ClipboardListIcon />
              <AlertTitle>Para publicar</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-0.5 ps-4">
                  {publishIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={(event) => event.preventDefault()} noValidate>
            <Accordion
              multiple
              value={openSections}
              onValueChange={(value) => setOpenSections((value as string[]) ?? [])}
              className="rounded-xl border px-4"
            >
              <AccordionItem value="identity">
                <AccordionTrigger>Identidade visual</AccordionTrigger>
                <AccordionContent>
                  <div className="pb-2">
                    <IdentitySection
                      template={template}
                      control={form.control}
                      setValue={form.setValue}
                      organizationBrand={organization.brand}
                      uploadTarget={uploadTarget}
                      disabled={disabled}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="content">
                <AccordionTrigger>Conteúdo</AccordionTrigger>
                <AccordionContent>
                  <div className="pb-2">
                    <ContentSection
                      template={template}
                      control={form.control}
                      disabled={disabled}
                      whatsappVariables={{
                        codigo:
                          properties.find((property) => property.status === "active")?.code ?? null,
                        pagina: watched.publication.name,
                      }}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {template.usesProperties !== "none" ? (
                <AccordionItem value="properties">
                  <AccordionTrigger>Imóveis</AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-3 pb-2">
                      <FieldDescription>
                        {template.usesProperties === "single"
                          ? "O imóvel que a página apresenta. Só imóveis ativos aparecem na busca."
                          : `Até ${maxProperties} imóveis ativos, na ordem da lista.`}
                      </FieldDescription>
                      <PropertyPicker
                        id="lp-imoveis"
                        mode={template.usesProperties}
                        max={maxProperties}
                        value={properties}
                        onChange={(next) => {
                          setPropertiesError(null)
                          setProperties(next)
                        }}
                        disabled={disabled}
                      />
                      {propertiesError ? (
                        <p className="text-sm text-destructive">{propertiesError}</p>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ) : null}

              <AccordionItem value="leads">
                <AccordionTrigger>Leads</AccordionTrigger>
                <AccordionContent>
                  <div className="pb-2">
                    <LeadsSection
                      members={members}
                      value={leadAssigneeId}
                      onChange={(next) => {
                        setLeadsError(null)
                        setLeadAssigneeId(next)
                      }}
                      error={leadsError}
                      disabled={disabled}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="publication">
                <AccordionTrigger>Divulgação</AccordionTrigger>
                <AccordionContent>
                  <div className="pb-2">
                    <PublicationSection
                      pageId={page.id}
                      control={form.control}
                      setValue={form.setValue}
                      organizationName={organization.name}
                      organizationSlug={organizationSlug}
                      status={status}
                      fallbackShareImagePath={fallbackShareImagePath}
                      uploadTarget={uploadTarget}
                      disabled={disabled}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </form>
        </div>

        <section
          aria-label="Pré-visualização"
          className={cn(
            "min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:flex lg:h-[calc(100svh-7rem)]",
            mobileView === "visualizar" ? "flex h-[calc(100svh-12rem)]" : "hidden"
          )}
        >
          <div className="flex items-center justify-between gap-2 lg:pe-6">
            <span className="text-sm font-medium">Pré-visualização ao vivo</span>
            <ToggleGroup
              value={[device]}
              onValueChange={(value) => {
                const next = value[0]
                if (next === "desktop" || next === "mobile") setDevice(next)
              }}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Tamanho da pré-visualização"
            >
              <ToggleGroupItem value="desktop" aria-label="Computador">
                <MonitorIcon />
              </ToggleGroupItem>
              <ToggleGroupItem value="mobile" aria-label="Celular">
                <SmartphoneIcon />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border lg:rounded-e-none lg:border-e-0">
            <LandingPreviewFrame device={device} title="Pré-visualização da página de captação">
              <LandingTemplate mode="preview" payload={payload} leadForm={<InertLeadForm />} />
            </LandingPreviewFrame>
          </div>
        </section>
      </div>

      <AlertDialog
        open={confirmStatus !== null}
        onOpenChange={(open) => (!open ? setConfirmStatus(null) : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {status === "archived" && confirmStatus === "draft"
                ? "Restaurar como rascunho?"
                : confirmCopy?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {status === "archived" && confirmStatus === "draft"
                ? "A página volta para a lista de ativas como rascunho."
                : confirmCopy?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChangingStatus}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmStatus === "archived" ? "destructive" : "default"}
              disabled={isChangingStatus}
              onClick={runStatusChange}
            >
              {isChangingStatus ? <Spinner data-icon="inline-start" /> : null}
              {status === "archived" && confirmStatus === "draft"
                ? "Restaurar"
                : confirmCopy?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <ClipboardListIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Falta pouco para publicar</AlertDialogTitle>
            <AlertDialogDescription>Resolva estes pontos e tente de novo:</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
            {shownIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setIssuesOpen(false)}>Entendi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}
