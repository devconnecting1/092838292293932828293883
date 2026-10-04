"use client"

import { EyeIcon, ExternalLinkIcon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react"
import { Controller, useWatch, type Control, type UseFormSetValue } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"

import { CopyField } from "@/components/configuracoes/copy-field"
import { ImageField } from "@/components/marketing/editor/image-field"
import type { LandingEditorFormValues, UploadTarget } from "@/components/marketing/editor/types"
import { SearchResultPreview, SharePreview } from "@/components/marketing/seo-previews"
import { getLandingAssetPublicUrl } from "@/lib/marketing/asset-url"
import {
  LANDING_NAME_MAX_LENGTH,
  LANDING_SLUG_MAX_LENGTH,
  SEO_DESCRIPTION_MAX_LENGTH,
  SEO_TITLE_MAX_LENGTH,
  landingPreviewPath,
  type LandingStatus,
} from "@/lib/marketing/constants"
import { countChars } from "@/lib/marketing/schemas"
import { slugify } from "@/lib/marketing/slug"
import {
  getLandingPublicUrl,
  getLandingPublicUrlPrefix,
  withLandingLeadOrigin,
} from "@/lib/marketing/urls"

function Counter({ count, max }: { count: number; max: number }) {
  return (
    <InputGroupText className={cn("tabular-nums", count > max && "text-destructive")}>
      {count}/{max}
    </InputGroupText>
  )
}

/** Normaliza enquanto digita (o hífen final é aceito até salvar). */
function normalizeSlugInput(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, LANDING_SLUG_MAX_LENGTH)
}

export function PublicationSection({
  pageId,
  control,
  setValue,
  organizationName,
  organizationSlug,
  status,
  fallbackShareImagePath,
  uploadTarget,
  disabled,
}: {
  pageId: string
  control: Control<LandingEditorFormValues>
  setValue: UseFormSetValue<LandingEditorFormValues>
  organizationName: string
  organizationSlug: string
  status: LandingStatus
  /** Imagem usada no compartilhamento quando não há uma específica. */
  fallbackShareImagePath: string | null
  uploadTarget: UploadTarget
  disabled: boolean
}) {
  const publication = useWatch({ control, name: "publication" })
  // Endereço no subdomínio da imobiliária: {slug}.{raiz}/lp/{página}.
  const publicUrl = getLandingPublicUrl(organizationSlug, publication.slug || "endereco")
  const urlPrefix = getLandingPublicUrlPrefix(organizationSlug) ?? "/lp/"
  const shareImageUrl =
    getLandingAssetPublicUrl(publication.ogImagePath) ??
    getLandingAssetPublicUrl(fallbackShareImagePath)
  const hasGtm = Boolean(publication.gtmContainerId.trim())
  const hasDirectTags = Boolean(publication.metaPixelId.trim() || publication.googleTagId.trim())

  return (
    <FieldGroup>
      <Controller
        name="publication.name"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
            <FieldLabel htmlFor="lp-nome">Nome interno</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="lp-nome"
                ref={field.ref}
                name={field.name}
                value={field.value}
                maxLength={LANDING_NAME_MAX_LENGTH}
                disabled={disabled}
                aria-invalid={fieldState.invalid || undefined}
                onBlur={field.onBlur}
                onChange={(event) => field.onChange(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Counter count={countChars(field.value)} max={LANDING_NAME_MAX_LENGTH} />
              </InputGroupAddon>
            </InputGroup>
            {fieldState.error ? (
              <FieldError errors={[fieldState.error]} />
            ) : (
              <FieldDescription>
                Só a equipe vê este nome (lista e relatórios de leads).
              </FieldDescription>
            )}
          </Field>
        )}
      />

      <Controller
        name="publication.slug"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
            <FieldLabel htmlFor="lp-slug">Endereço da página</FieldLabel>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <InputGroupText className="max-w-48 truncate" title={urlPrefix}>
                  {urlPrefix}
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="lp-slug"
                ref={field.ref}
                name={field.name}
                value={field.value}
                spellCheck={false}
                autoComplete="off"
                maxLength={LANDING_SLUG_MAX_LENGTH}
                disabled={disabled}
                aria-invalid={fieldState.invalid || undefined}
                onBlur={field.onBlur}
                onChange={(event) => field.onChange(normalizeSlugInput(event.target.value))}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  disabled={disabled || !slugify(publication.name)}
                  onClick={() =>
                    setValue("publication.slug", slugify(publication.name), {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <WandSparklesIcon />
                  <span className="sr-only">Gerar endereço a partir do nome</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {fieldState.error ? (
              <FieldError errors={[fieldState.error]} />
            ) : (
              <FieldDescription>
                Letras minúsculas, números e hífens (3 a 60). Trocar o endereço de uma página
                publicada quebra os links já divulgados.
              </FieldDescription>
            )}
          </Field>
        )}
      />

      <Field>
        <FieldLabel htmlFor="lp-url-publica">URL pública</FieldLabel>
        {publicUrl ? (
          <CopyField
            id="lp-url-publica"
            value={publicUrl}
            successMessage="Endereço da landing page copiado."
          />
        ) : (
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>
              O endereço desta imobiliária não pode ser usado como subdomínio. Fale com o suporte
              para ajustar.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {status === "published" && publicUrl ? (
            <Button
              variant="outline"
              size="sm"
              render={<a href={publicUrl} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Abrir página
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={landingPreviewPath(pageId)} target="_blank" rel="noopener noreferrer" />
            }
            nativeButton={false}
          >
            <EyeIcon data-icon="inline-start" />
            Pré-visualizar em tela cheia
          </Button>
        </div>
        {status !== "published" ? (
          <FieldDescription>
            O endereço só abre para o público depois de publicar a página.
          </FieldDescription>
        ) : null}
      </Field>

      {publicUrl ? (
        <Field>
          <FieldLabel htmlFor="lp-url-instagram">Link para a bio do Instagram</FieldLabel>
          <CopyField
            id="lp-url-instagram"
            value={withLandingLeadOrigin(publicUrl, "instagram")}
            successMessage="Link para a bio do Instagram copiado."
          />
          <FieldDescription>
            Quem chega por este link entra como lead de origem Instagram (e o mesmo vale para o link
            de WhatsApp abaixo, com origem WhatsApp). Assim o relatório de origem mostra se a bio
            traz clientes.
          </FieldDescription>
          <CopyField
            id="lp-url-whatsapp"
            label="Link para mensagens de WhatsApp"
            value={withLandingLeadOrigin(publicUrl, "whatsapp")}
            successMessage="Link para WhatsApp copiado."
          />
        </Field>
      ) : null}

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">Busca e compartilhamento</FieldLegend>
        <FieldGroup className="gap-4">
          <Controller
            name="publication.seoTitle"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="lp-seo-titulo">
                  Título da página <span className="text-muted-foreground">(recomendado)</span>
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="lp-seo-titulo"
                    ref={field.ref}
                    name={field.name}
                    value={field.value}
                    maxLength={SEO_TITLE_MAX_LENGTH}
                    disabled={disabled}
                    aria-invalid={fieldState.invalid || undefined}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <Counter count={countChars(field.value)} max={SEO_TITLE_MAX_LENGTH} />
                  </InputGroupAddon>
                </InputGroup>
                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Aparece na aba do navegador, no Google e no link compartilhado.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
          <Controller
            name="publication.seoDescription"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="lp-seo-descricao">Descrição</FieldLabel>
                <InputGroup>
                  <InputGroupTextarea
                    id="lp-seo-descricao"
                    ref={field.ref}
                    name={field.name}
                    rows={3}
                    value={field.value}
                    maxLength={SEO_DESCRIPTION_MAX_LENGTH}
                    disabled={disabled}
                    aria-invalid={fieldState.invalid || undefined}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                  <InputGroupAddon align="block-end" className="justify-end">
                    <Counter count={countChars(field.value)} max={SEO_DESCRIPTION_MAX_LENGTH} />
                  </InputGroupAddon>
                </InputGroup>
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />

          <SearchResultPreview
            siteName={organizationName}
            url={publicUrl ?? urlPrefix}
            title={publication.seoTitle}
            description={publication.seoDescription}
          />

          <Controller
            name="publication.ogImagePath"
            control={control}
            render={({ field }) => (
              <ImageField
                id="lp-imagem-compartilhamento"
                label="Imagem de compartilhamento"
                description="Mostrada no WhatsApp, Facebook e LinkedIn. Ideal: 1200 × 630 px; a imagem é otimizada antes do envio."
                path={field.value}
                onChange={field.onChange}
                target={uploadTarget}
                aspect="wide"
                fallbackUrl={getLandingAssetPublicUrl(fallbackShareImagePath)}
                fallbackNote={
                  fallbackShareImagePath
                    ? "Sem imagem própria: usamos o fundo ou o primeiro banner da página."
                    : "Sem imagem: o link aparece sem foto."
                }
                disabled={disabled}
              />
            )}
          />

          <SharePreview
            url={publicUrl ?? urlPrefix}
            title={publication.seoTitle}
            description={publication.seoDescription}
            imageUrl={shareImageUrl}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">Rastreamento de anúncios</FieldLegend>
        <FieldDescription>
          Os eventos de visita e de lead enviado são disparados pela página publicada.
        </FieldDescription>
        <FieldGroup className="gap-4">
          <Controller
            name="publication.metaPixelId"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="lp-meta-pixel">Meta Pixel ID</FieldLabel>
                <Input
                  id="lp-meta-pixel"
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={20}
                  placeholder="123456789012345"
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value.replace(/\D/g, ""))}
                />
                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Só os números, no Gerenciador de Eventos da Meta.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
          <Controller
            name="publication.googleTagId"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="lp-google-tag">Google Tag ID</FieldLabel>
                <Input
                  id="lp-google-tag"
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={24}
                  placeholder="G-XXXXXXXXXX"
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={field.onBlur}
                  onChange={(event) =>
                    field.onChange(event.target.value.replace(/\s/g, "").toUpperCase())
                  }
                />
                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Google Analytics 4 (G-), Google tag (GT-) ou Google Ads (AW-).
                  </FieldDescription>
                )}
              </Field>
            )}
          />
          {/*
            GTM indisponível por segurança: o contêiner roda qualquer código na página, e a
            página publicada fica no mesmo endereço do CRM (ver LandingTracking). O campo só
            mostra o ID salvo, que continua no formulário e é mantido ao salvar.
          */}
          <Controller
            name="publication.gtmContainerId"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="lp-gtm">Google Tag Manager</FieldLabel>
                  <Badge variant="secondary">indisponível</Badge>
                </div>
                <Input
                  id="lp-gtm"
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Indisponível por enquanto"
                  disabled
                  aria-invalid={fieldState.invalid || undefined}
                  readOnly
                />
                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Por segurança, a página publicada não carrega o Google Tag Manager por enquanto.
                    Use o Meta Pixel e a Google Tag acima.
                  </FieldDescription>
                )}
              </Field>
            )}
          />

          {hasGtm ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>O Google Tag Manager está pausado nesta página</AlertTitle>
              <AlertDescription>
                O contêiner do Google Tag Manager pode rodar qualquer código na página, e as páginas
                publicadas ainda ficam no mesmo endereço do CRM, onde a sua equipe está conectada.
                Para proteger as contas, ele não é carregado. O ID salvo fica guardado para quando
                as páginas tiverem endereço próprio.
                {hasDirectTags
                  ? " Esta página já envia o Pixel e/ou a Google Tag preenchidos acima."
                  : " Enquanto isso, preencha o Meta Pixel e a Google Tag acima para medir visitas e leads."}
              </AlertDescription>
            </Alert>
          ) : null}

          <Field data-disabled>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="lp-meta-capi">
                Token da API de Conversões da Meta (CAPI)
              </FieldLabel>
              <Badge variant="secondary">em breve</Badge>
            </div>
            <Input
              id="lp-meta-capi"
              disabled
              placeholder="Disponível em breve"
              autoComplete="off"
            />
            <FieldDescription>
              Envio de conversões direto do servidor para a Meta, mais preciso com bloqueadores de
              anúncio.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  )
}
