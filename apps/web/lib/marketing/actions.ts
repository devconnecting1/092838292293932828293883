"use server"

import { revalidatePath } from "next/cache"

import type { Json } from "@workspace/database/types"

import { requireMembership } from "@/lib/auth/session"
import { buildPropertySearchFilter, sanitizeSearchTerm } from "@/lib/clientes/search"
import { readOrganizationBrand } from "@/lib/configuracoes/brand"
import { formatDate } from "@/lib/format"
import { isUuid } from "@/lib/imoveis/ids"
import { getLandingTemplate, type LandingTemplateDefinition } from "@/lib/landing/templates"
import {
  isLandingTemplateKey,
  parseLandingContent,
  parseLandingTheme,
  type LandingSeo,
  type LandingTemplateKey,
  type LandingTheme,
} from "@/lib/landing/types"
import { isLandingAssetPath } from "@/lib/marketing/asset-url"
import {
  LANDING_ASSETS_BUCKET,
  LANDING_NAME_MAX_LENGTH,
  LANDING_PAGES_PATH,
  LANDING_STATUSES,
  SEO_DESCRIPTION_MAX_LENGTH,
  SEO_TITLE_MAX_LENGTH,
  landingPreviewPath,
  type LandingStatus,
} from "@/lib/marketing/constants"
import type { LandingPageRecord, LandingPageUpdate } from "@/lib/marketing/db-types"
import {
  LANDING_PERMISSION_MESSAGE,
  LANDING_SLUG_TAKEN_MESSAGE,
  translateLandingError,
} from "@/lib/marketing/errors"
import { toLandingPropertySnapshot, type LandingPropertyOption } from "@/lib/marketing/payload"
import { canEditLandingPages } from "@/lib/marketing/permissions"
import {
  LANDING_PROPERTY_SELECT,
  getLandingPageRow,
  getTakenLandingSlugs,
} from "@/lib/marketing/queries"
import {
  buildContentSchema,
  buildPropertyIdsSchema,
  clipText,
  collectFieldErrors,
  contentValuesToContent,
  getPublishIssues,
  identitySchema,
  identityValuesToTheme,
  leadAssigneeSchema,
  publicationSchema,
  publicationValuesToColumns,
  readLandingSeo,
  type ContentValues,
  type IdentityValues,
  type PublicationValues,
} from "@/lib/marketing/schemas"
import { uniqueSlug } from "@/lib/marketing/slug"
import { buildLandingPublicPath } from "@/lib/marketing/urls"
import { createClient } from "@/lib/supabase/server"

// Regras de gravação em landing_pages:
// - organization_id vem sempre da sessão (imobiliária atual), nunca do cliente;
// - created_by NÃO é enviado: um trigger grava auth.uid() e o grant por coluna
//   bloqueia a coluna para o app;
// - leituras usam colunas explícitas (nunca `*`).

export type LandingActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export type LandingCreateResult =
  { ok: true; id: string; message?: string } | { ok: false; error: string }

export type LandingStatusResult =
  | {
      ok: true
      message: string
      status: LandingStatus
      publishedAt: string | null
    }
  | { ok: false; error: string; issues?: string[] }

const INVALID_DATA_MESSAGE = "Confira os campos destacados."
const LOAD_ERROR_MESSAGE = "Não foi possível carregar a landing page agora. Tente novamente."

type EditContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  organizationId: string
  organizationSlug: string
  row: LandingPageRecord
  templateKey: LandingTemplateKey
  template: LandingTemplateDefinition
}

/**
 * Sessão, papel e landing page da imobiliária atual. O RLS continua sendo a
 * garantia; a checagem aqui dá mensagens melhores.
 */
async function getEditContext(
  pageId: string
): Promise<{ ok: true; context: EditContext } | { ok: false; error: string }> {
  const { membership } = await requireMembership()

  if (!canEditLandingPages(membership.role)) {
    return { ok: false, error: LANDING_PERMISSION_MESSAGE }
  }
  if (!isUuid(pageId)) {
    return { ok: false, error: "Landing page inválida." }
  }

  const supabase = await createClient()
  let row: LandingPageRecord | null

  try {
    row = await getLandingPageRow(supabase, membership.organizationId, pageId)
  } catch {
    return { ok: false, error: LOAD_ERROR_MESSAGE }
  }

  if (!row) {
    return {
      ok: false,
      error: "Landing page não encontrada nesta imobiliária.",
    }
  }
  if (!isLandingTemplateKey(row.template)) {
    return {
      ok: false,
      error: "O modelo desta landing page não é reconhecido.",
    }
  }

  return {
    ok: true,
    context: {
      supabase,
      organizationId: membership.organizationId,
      organizationSlug: membership.organization.slug,
      row,
      templateKey: row.template,
      template: getLandingTemplate(row.template),
    },
  }
}

async function updateRow(
  context: EditContext,
  patch: LandingPageUpdate,
  action: string
): Promise<{ ok: true } | { ok: false; error: string; code: string | null }> {
  const { data, error } = await context.supabase
    .from("landing_pages")
    .update(patch)
    .eq("organization_id", context.organizationId)
    .eq("id", context.row.id)
    .select("id")

  if (error) {
    return {
      ok: false,
      error: translateLandingError(error, action),
      code: error.code ?? null,
    }
  }
  // Com RLS, um UPDATE sem permissão não dá erro: só não altera nenhuma linha.
  if (!data?.length) {
    return { ok: false, error: LANDING_PERMISSION_MESSAGE, code: "42501" }
  }
  return { ok: true }
}

function revalidateLanding(context: EditContext, slugs: readonly string[] = [context.row.slug]) {
  revalidatePath(LANDING_PAGES_PATH)
  revalidatePath(landingPreviewPath(context.row.id))
  for (const slug of new Set(slugs)) {
    revalidatePath(buildLandingPublicPath(context.organizationSlug, slug))
  }
}

function referencedAssetPaths(theme: unknown, seo: unknown) {
  const parsedTheme = parseLandingTheme(theme)
  const parsedSeo = readLandingSeo(seo)
  return new Set(
    [
      parsedTheme.logo_path,
      parsedTheme.background_image_path,
      ...(parsedTheme.banner_image_paths ?? []),
      parsedSeo.og_image_path,
    ].filter((path): path is string => Boolean(path))
  )
}

/** Apaga do bucket as imagens desta página que deixaram de ser usadas. */
async function removeUnusedAssets(context: EditContext, before: Set<string>, after: Set<string>) {
  const stale = [...before].filter(
    (path) => !after.has(path) && isLandingAssetPath(path, context.organizationId, context.row.id)
  )
  if (stale.length === 0) return
  // Falha aqui não desfaz o salvamento: o arquivo só fica órfão no bucket.
  await context.supabase.storage.from(LANDING_ASSETS_BUCKET).remove(stale)
}

// ---------------------------------------------------------------------------
// Criar, duplicar e mudar status
// ---------------------------------------------------------------------------

export async function createLandingPageAction(templateKey: string): Promise<LandingCreateResult> {
  if (!isLandingTemplateKey(templateKey)) {
    return {
      ok: false,
      error: "Modelo inválido. Escolha um dos modelos da galeria.",
    }
  }

  const { membership } = await requireMembership()

  if (!canEditLandingPages(membership.role)) {
    return { ok: false, error: LANDING_PERMISSION_MESSAGE }
  }

  const organizationId = membership.organizationId
  const supabase = await createClient()
  const template = getLandingTemplate(templateKey)

  const [{ data: organization }, taken] = await Promise.all([
    supabase.from("organizations").select("name, brand").eq("id", organizationId).maybeSingle(),
    getTakenLandingSlugs(supabase, organizationId),
  ])

  const organizationName = organization?.name ?? membership.organization.name
  const brand = readOrganizationBrand(organization?.brand)
  const maxLength = (key: string, fallback: number) =>
    template.fields.find((field) => field.key === key)?.maxLength ?? fallback

  const content = parseLandingContent({
    headline: clipText(template.defaults.headline, maxLength("headline", 120)),
    subheadline: clipText(template.defaults.subheadline, maxLength("subheadline", 240)),
    cta_label: clipText(template.defaults.cta_label, maxLength("cta_label", 40)),
  })

  const titleWithBrand = `${template.defaults.headline} | ${organizationName}`
  const seo: LandingSeo = {
    title: clipText(
      Array.from(titleWithBrand).length <= SEO_TITLE_MAX_LENGTH
        ? titleWithBrand
        : template.defaults.headline,
      SEO_TITLE_MAX_LENGTH
    ),
    description: clipText(template.defaults.subheadline, SEO_DESCRIPTION_MAX_LENGTH),
  }

  const theme: LandingTheme = brand.primaryColor ? { primary_color: brand.primaryColor } : {}
  const name = clipText(`${template.name} · ${formatDate(new Date())}`, LANDING_NAME_MAX_LENGTH)
  let slug = uniqueSlug(template.name, taken)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase
      .from("landing_pages")
      .insert({
        organization_id: organizationId,
        template: templateKey,
        name,
        slug,
        status: "draft",
        theme: theme as Json,
        content: content as Json,
        seo: seo as Json,
        tracking: {},
        property_ids: [],
        lead_assignee_id: null,
      })
      .select("id")
      .single()

    if (!error && data) {
      revalidatePath(LANDING_PAGES_PATH)
      return { ok: true, id: data.id, message: "Rascunho criado." }
    }

    // Outra pessoa criou o mesmo slug ao mesmo tempo: tenta com sufixo.
    if (error?.code === "23505" && attempt === 0) {
      slug = uniqueSlug(`${slug}-${crypto.randomUUID().slice(0, 4)}`, taken)
      continue
    }

    return {
      ok: false,
      error: translateLandingError(error ?? {}, "criar a landing page"),
    }
  }

  return {
    ok: false,
    error: "Não foi possível criar a landing page agora. Tente novamente.",
  }
}

export async function duplicateLandingPageAction(pageId: string): Promise<LandingCreateResult> {
  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context
  const { row, supabase, organizationId } = context
  const taken = await getTakenLandingSlugs(supabase, organizationId)
  const name = clipText(`Cópia de ${row.name}`, LANDING_NAME_MAX_LENGTH)
  const slug = uniqueSlug(`${row.slug}-copia`, taken)
  const seo = readLandingSeo(row.seo)
  const theme = parseLandingTheme(row.theme)
  const seoWithoutImage: LandingSeo = { ...seo }
  delete seoWithoutImage.og_image_path

  // 1) Cria a cópia sem imagens (o Storage pode exigir a página existente).
  const { data: created, error } = await supabase
    .from("landing_pages")
    .insert({
      organization_id: organizationId,
      template: context.templateKey,
      name,
      slug,
      status: "draft",
      theme: {
        ...theme,
        logo_path: null,
        background_image_path: null,
        banner_image_paths: [],
      } as Json,
      content: row.content,
      property_ids: row.property_ids,
      tracking: row.tracking,
      seo: seoWithoutImage as Json,
      lead_assignee_id: row.lead_assignee_id,
    })
    .select("id")
    .single()

  if (error || !created) {
    return {
      ok: false,
      error: translateLandingError(error ?? {}, "duplicar a landing page"),
    }
  }

  // 2) Copia as imagens para a pasta da nova página e grava os novos caminhos.
  const bucket = supabase.storage.from(LANDING_ASSETS_BUCKET)
  const copyAsset = async (path: string | null | undefined) => {
    if (!isLandingAssetPath(path, organizationId, row.id)) return null
    const extension = path.split(".").pop() ?? "jpg"
    const target = `${organizationId}/landing/${created.id}/${crypto.randomUUID()}.${extension}`
    const { error: copyError } = await bucket.copy(path, target)
    return copyError ? null : target
  }

  const [logoPath, backgroundPath, ogImagePath, ...bannerPaths] = await Promise.all([
    copyAsset(theme.logo_path),
    copyAsset(theme.background_image_path),
    copyAsset(seo.og_image_path),
    ...(theme.banner_image_paths ?? []).map((path) => copyAsset(path)),
  ])

  const originalCount = referencedAssetPaths(row.theme, row.seo).size
  const copied = [logoPath, backgroundPath, ogImagePath, ...bannerPaths].filter(Boolean)

  if (copied.length > 0) {
    const nextSeo: LandingSeo = { ...seoWithoutImage }
    if (ogImagePath) nextSeo.og_image_path = ogImagePath

    await supabase
      .from("landing_pages")
      .update({
        theme: parseLandingTheme({
          ...theme,
          logo_path: logoPath,
          background_image_path: backgroundPath,
          banner_image_paths: bannerPaths.filter(Boolean),
        }) as Json,
        seo: nextSeo as Json,
      })
      .eq("organization_id", organizationId)
      .eq("id", created.id)
  }

  revalidatePath(LANDING_PAGES_PATH)

  return {
    ok: true,
    id: created.id,
    message:
      copied.length < originalCount
        ? "Cópia criada como rascunho. Algumas imagens não puderam ser copiadas; envie-as de novo."
        : "Cópia criada como rascunho.",
  }
}

async function countActiveProperties(context: EditContext) {
  const ids = context.row.property_ids ?? []
  if (ids.length === 0) return 0

  const { count, error } = await context.supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", context.organizationId)
    .eq("status", "active")
    .in("id", ids)

  return error ? 0 : (count ?? 0)
}

const STATUS_MESSAGES = {
  published: "Landing page publicada.",
  unpublished: "Landing page despublicada. Ela voltou a ser rascunho.",
  restored: "Landing page restaurada como rascunho.",
  archived: "Landing page arquivada.",
} as const

export async function setLandingStatusAction(
  pageId: string,
  status: LandingStatus
): Promise<LandingStatusResult> {
  if (!(LANDING_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Status inválido." }
  }

  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context
  const { row } = context

  if (row.status === status) {
    return {
      ok: true,
      message: "Nada a alterar.",
      status,
      publishedAt: row.published_at,
    }
  }

  if (status === "published") {
    const issues = getPublishIssues({
      template: context.template,
      content: parseLandingContent(row.content),
      seo: readLandingSeo(row.seo),
      activePropertyCount: await countActiveProperties(context),
    })

    if (issues.length > 0) {
      return {
        ok: false,
        error: `Antes de publicar: ${issues.join(" ")}`,
        issues,
      }
    }
  }

  // published_at é gravado pelo banco (trigger) ao publicar: o app só muda o status.
  const { data: updated, error } = await context.supabase
    .from("landing_pages")
    .update({ status })
    .eq("organization_id", context.organizationId)
    .eq("id", row.id)
    .select("id, status, published_at")

  if (error) {
    return {
      ok: false,
      error: translateLandingError(error, "alterar o status da landing page"),
    }
  }

  const saved = updated?.[0]
  // Com RLS, um UPDATE sem permissão não dá erro: só não altera nenhuma linha.
  if (!saved) {
    return { ok: false, error: LANDING_PERMISSION_MESSAGE }
  }

  revalidateLanding(context)

  const message =
    status === "published"
      ? STATUS_MESSAGES.published
      : status === "archived"
        ? STATUS_MESSAGES.archived
        : row.status === "archived"
          ? STATUS_MESSAGES.restored
          : STATUS_MESSAGES.unpublished

  return { ok: true, message, status, publishedAt: saved.published_at }
}

// ---------------------------------------------------------------------------
// Salvamento por seção (usado pelo salvamento automático do editor)
// ---------------------------------------------------------------------------

export async function saveLandingIdentityAction(
  pageId: string,
  values: IdentityValues
): Promise<LandingActionResult> {
  const parsed = identitySchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_DATA_MESSAGE,
      fieldErrors: collectFieldErrors(parsed.error),
    }
  }

  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context
  const data = parsed.data
  const paths = [data.logoPath, data.backgroundPath, ...data.bannerPaths].filter(
    (path): path is string => Boolean(path)
  )

  if (!paths.every((path) => isLandingAssetPath(path, context.organizationId, context.row.id))) {
    return {
      ok: false,
      error: "Uma imagem foi enviada para uma pasta inválida. Envie-a de novo.",
    }
  }
  if (data.bannerPaths.length > context.template.imageSlots.banners) {
    return {
      ok: false,
      error:
        context.template.imageSlots.banners === 0
          ? "Este modelo não usa banners."
          : `Este modelo aceita no máximo ${context.template.imageSlots.banners} banners.`,
    }
  }

  const theme = identityValuesToTheme(data, context.template)
  const before = referencedAssetPaths(context.row.theme, context.row.seo)
  const result = await updateRow(context, { theme: theme as Json }, "salvar a identidade visual")

  if (!result.ok) return { ok: false, error: result.error }

  await removeUnusedAssets(context, before, referencedAssetPaths(theme, context.row.seo))
  revalidateLanding(context)

  return { ok: true }
}

export async function saveLandingContentAction(
  pageId: string,
  values: ContentValues
): Promise<LandingActionResult> {
  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context
  const parsed = buildContentSchema(context.template).safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_DATA_MESSAGE,
      fieldErrors: collectFieldErrors(parsed.error),
    }
  }

  const content = contentValuesToContent(parsed.data, context.template)
  const result = await updateRow(context, { content: content as Json }, "salvar o conteúdo")

  if (!result.ok) return { ok: false, error: result.error }

  revalidateLanding(context)
  return { ok: true }
}

export async function saveLandingPropertiesAction(
  pageId: string,
  propertyIds: string[]
): Promise<LandingActionResult> {
  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context
  const parsed = buildPropertyIdsSchema(context.template).safeParse(propertyIds)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? INVALID_DATA_MESSAGE,
    }
  }

  const ids = context.template.usesProperties === "none" ? [] : parsed.data

  if (ids.length > 0) {
    const { data: properties, error } = await context.supabase
      .from("properties")
      .select("id, code, status")
      .eq("organization_id", context.organizationId)
      .in("id", ids)

    if (error) {
      return {
        ok: false,
        error: "Não foi possível conferir os imóveis agora. Tente novamente.",
      }
    }

    const found = new Map((properties ?? []).map((property) => [property.id, property]))

    if (ids.some((id) => !found.has(id))) {
      return {
        ok: false,
        error: "Algum imóvel selecionado não existe mais nesta imobiliária. Remova-o da lista.",
      }
    }

    const inactive = (properties ?? []).filter((property) => property.status !== "active")
    if (inactive.length > 0) {
      return {
        ok: false,
        error: `Somente imóveis ativos podem aparecer na página. Remova: ${inactive
          .map((property) => property.code)
          .join(", ")}.`,
      }
    }
  }

  const result = await updateRow(context, { property_ids: ids }, "salvar os imóveis da página")
  if (!result.ok) return { ok: false, error: result.error }

  revalidateLanding(context)
  return { ok: true }
}

export async function saveLandingLeadsAction(
  pageId: string,
  assigneeId: string | null
): Promise<LandingActionResult> {
  const parsed = leadAssigneeSchema.safeParse(assigneeId)
  if (!parsed.success) {
    return {
      ok: false,
      error: "Selecione um membro da equipe.",
      fieldErrors: { leadAssigneeId: "Membro inválido." },
    }
  }

  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context

  if (parsed.data) {
    const { data: member, error } = await context.supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", context.organizationId)
      .eq("user_id", parsed.data)
      .eq("active", true)
      .maybeSingle()

    if (error || !member) {
      return {
        ok: false,
        error: "Escolha um membro ativo da equipe.",
        fieldErrors: {
          leadAssigneeId: "Este membro não está ativo nesta imobiliária.",
        },
      }
    }
  }

  const result = await updateRow(
    context,
    { lead_assignee_id: parsed.data },
    "salvar o responsável pelos leads"
  )
  if (!result.ok) return { ok: false, error: result.error }

  revalidateLanding(context)
  return { ok: true }
}

export async function saveLandingPublicationAction(
  pageId: string,
  values: PublicationValues
): Promise<LandingActionResult> {
  const parsed = publicationSchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_DATA_MESSAGE,
      fieldErrors: collectFieldErrors(parsed.error),
    }
  }

  const loaded = await getEditContext(pageId)
  if (!loaded.ok) return loaded

  const context = loaded.context
  const columns = publicationValuesToColumns(parsed.data)

  if (
    columns.seo.og_image_path &&
    !isLandingAssetPath(columns.seo.og_image_path, context.organizationId, context.row.id)
  ) {
    return {
      ok: false,
      error: "A imagem de compartilhamento foi enviada para uma pasta inválida. Envie-a de novo.",
    }
  }

  if (columns.slug !== context.row.slug) {
    const { data: clash } = await context.supabase
      .from("landing_pages")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("slug", columns.slug)
      .neq("id", context.row.id)
      .limit(1)

    if (clash?.length) {
      return {
        ok: false,
        error: LANDING_SLUG_TAKEN_MESSAGE,
        fieldErrors: {
          slug: "Este endereço já está em uso em outra landing page.",
        },
      }
    }
  }

  const before = referencedAssetPaths(context.row.theme, context.row.seo)
  const result = await updateRow(
    context,
    {
      name: columns.name,
      slug: columns.slug,
      seo: columns.seo as Json,
      tracking: columns.tracking as Json,
    },
    "salvar a divulgação"
  )

  if (!result.ok) {
    if (result.code === "23505") {
      return {
        ok: false,
        error: LANDING_SLUG_TAKEN_MESSAGE,
        fieldErrors: {
          slug: "Este endereço já está em uso em outra landing page.",
        },
      }
    }
    return { ok: false, error: result.error }
  }

  await removeUnusedAssets(context, before, referencedAssetPaths(context.row.theme, columns.seo))
  revalidateLanding(context, [context.row.slug, columns.slug])

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Busca de imóveis ativos
// ---------------------------------------------------------------------------

const PROPERTY_SEARCH_LIMIT = 20
const PROPERTY_MEDIA_PER_RESULT = 20

/** Imóveis ATIVOS da imobiliária por código, título ou bairro. */
export async function searchLandingPropertiesAction(
  query: string
): Promise<LandingPropertyOption[]> {
  const { membership } = await requireMembership()
  const term = sanitizeSearchTerm(query)
  const supabase = await createClient()

  let request = supabase
    .from("properties")
    .select(LANDING_PROPERTY_SELECT)
    .eq("organization_id", membership.organizationId)
    .eq("status", "active")
    .eq("property_media.kind", "image")
    .order("is_cover", { referencedTable: "property_media", ascending: false })
    .order("position", { referencedTable: "property_media" })
    .limit(PROPERTY_MEDIA_PER_RESULT, { referencedTable: "property_media" })
    .order("updated_at", { ascending: false })
    .limit(PROPERTY_SEARCH_LIMIT)

  if (term) {
    request = request.or(buildPropertySearchFilter(term))
  }

  const { data, error } = await request

  if (error || !data) {
    return []
  }

  return data.map(({ property_media: media, ...property }) => {
    const snapshot = toLandingPropertySnapshot({
      ...property,
      imagePaths: (media ?? [])
        .map((item) => item.storage_path)
        .filter((path): path is string => Boolean(path)),
    })

    return {
      id: property.id,
      label: `${property.code} · ${property.title}`,
      description: [property.neighborhood, property.city].filter(Boolean).join(" · ") || null,
      property: snapshot,
    }
  })
}
