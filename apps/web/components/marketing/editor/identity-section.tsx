"use client"

import { PaletteIcon } from "lucide-react"
import { Controller, useWatch, type Control, type UseFormSetValue } from "react-hook-form"

import { Button } from "@workspace/ui/components/button"
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"

import { ColorField } from "@/components/marketing/editor/color-field"
import { ImageField, ImageListField } from "@/components/marketing/editor/image-field"
import type { LandingEditorFormValues, UploadTarget } from "@/components/marketing/editor/types"
import type { LandingTemplateDefinition } from "@/lib/landing/templates"
import {
  deriveAccent,
  deriveSecondary,
  isHexColor,
  resolveLandingTheme,
  type HexColor,
} from "@/lib/landing/theme"
import type { LandingOrganizationBrand } from "@/lib/landing/types"
import { getLandingAssetPublicUrl } from "@/lib/marketing/asset-url"
import { identityValuesToTheme } from "@/lib/marketing/schemas"

const WHITE = "#FFFFFF"

/**
 * Aviso quando o tema precisa ajustar a cor para manter o contraste do texto
 * (WCAG AA): escurecer o preenchimento ou trocar o texto branco por escuro.
 */
function contrastWarning(base: HexColor, fill: HexColor, text: HexColor) {
  if (fill.toUpperCase() !== base.toUpperCase()) {
    return `Contraste ajustado: para o texto branco ficar legível, botões e faixas usam o tom ${fill}.`
  }
  if (text.toUpperCase() !== WHITE) {
    return "Cor clara: o texto sobre ela fica escuro para manter a leitura."
  }
  return null
}

export function IdentitySection({
  template,
  control,
  setValue,
  organizationBrand,
  uploadTarget,
  disabled,
}: {
  template: LandingTemplateDefinition
  control: Control<LandingEditorFormValues>
  setValue: UseFormSetValue<LandingEditorFormValues>
  organizationBrand: LandingOrganizationBrand
  uploadTarget: UploadTarget
  disabled: boolean
}) {
  const identity = useWatch({ control, name: "identity" })
  const resolved = resolveLandingTheme(
    identityValuesToTheme(identity, template),
    organizationBrand,
    {
      storageBaseUrl: null,
    }
  )
  const { colors } = resolved
  const secondaryBase = isHexColor(identity.secondaryColor)
    ? (identity.secondaryColor.toUpperCase() as HexColor)
    : deriveSecondary(colors.brand)
  const accentBase = isHexColor(identity.accentColor)
    ? (identity.accentColor.toUpperCase() as HexColor)
    : deriveAccent(colors.brand)

  const primaryDescription =
    resolved.source.primary === "theme"
      ? "Botões, links e destaques da página."
      : resolved.source.primary === "organization"
        ? "Em branco: usa a cor da marca da imobiliária."
        : "Em branco: usa a cor padrão, pois a imobiliária não tem cor cadastrada."

  function applyOrganizationColors() {
    const options = { shouldDirty: true, shouldValidate: true } as const
    setValue("identity.primaryColor", organizationBrand.primary_color ?? "", options)
    setValue("identity.secondaryColor", "", options)
    setValue("identity.accentColor", "", options)
  }

  const hasOrganizationLogo = Boolean(organizationBrand.logo_url)

  return (
    <FieldGroup>
      <FieldSet>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLegend variant="label" className="mb-0">
            Cores da marca
          </FieldLegend>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={applyOrganizationColors}
          >
            <PaletteIcon data-icon="inline-start" />
            Usar cores da imobiliária
          </Button>
        </div>
        <FieldDescription>
          A secundária e a de destaque podem ficar em branco: são derivadas da cor primária.
        </FieldDescription>
        <FieldGroup className="gap-4">
          <Controller
            name="identity.primaryColor"
            control={control}
            render={({ field, fieldState }) => (
              <ColorField
                id="lp-cor-primaria"
                label="Cor primária"
                value={field.value}
                resolvedColor={colors.brand}
                description={primaryDescription}
                warning={contrastWarning(colors.brand, colors.primary, colors.onPrimary)}
                error={fieldState.error?.message}
                disabled={disabled}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <Controller
            name="identity.secondaryColor"
            control={control}
            render={({ field, fieldState }) => (
              <ColorField
                id="lp-cor-secundaria"
                label="Cor secundária"
                value={field.value}
                resolvedColor={secondaryBase}
                description="Rodapé e faixas escuras."
                warning={contrastWarning(secondaryBase, colors.secondary, colors.onSecondary)}
                error={fieldState.error?.message}
                disabled={disabled}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <Controller
            name="identity.accentColor"
            control={control}
            render={({ field, fieldState }) => (
              <ColorField
                id="lp-cor-destaque"
                label="Cor de destaque"
                value={field.value}
                resolvedColor={accentBase}
                description="Selos, contagem regressiva e pequenos destaques."
                warning={contrastWarning(accentBase, colors.accent, colors.onAccent)}
                error={fieldState.error?.message}
                disabled={disabled}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <Controller
        name="identity.logoPath"
        control={control}
        render={({ field }) => (
          <ImageField
            id="lp-logo"
            label="Logo"
            description="PNG com fundo transparente fica melhor. JPG, PNG, WebP ou HEIC; otimizamos para até 512 px, mantendo a transparência."
            path={field.value}
            onChange={field.onChange}
            target={uploadTarget}
            aspect="logo"
            fit="contain"
            fallbackUrl={organizationBrand.logo_url ?? null}
            fallbackNote={
              hasOrganizationLogo
                ? "Usando o logo da imobiliária."
                : "Sem logo: a página mostra as iniciais da imobiliária."
            }
            disabled={disabled}
          />
        )}
      />

      {template.imageSlots.background ? (
        <Controller
          name="identity.backgroundPath"
          control={control}
          render={({ field }) => (
            <ImageField
              id="lp-fundo"
              label="Imagem de fundo"
              description="Aparece atrás do título principal. Use pelo menos 1920 × 1080 px; a imagem é otimizada para 1920 px antes do envio."
              path={field.value}
              onChange={field.onChange}
              target={uploadTarget}
              aspect="wide"
              fallbackNote={
                template.usesProperties === "single"
                  ? "Sem imagem: a página usa a capa do imóvel."
                  : "Sem imagem: a página usa um fundo na cor da marca."
              }
              disabled={disabled}
            />
          )}
        />
      ) : null}

      {template.imageSlots.banners > 0 ? (
        <Controller
          name="identity.bannerPaths"
          control={control}
          render={({ field }) => (
            <ImageListField
              label={template.imageSlots.banners === 1 ? "Banner" : "Banners"}
              description={`Até ${template.imageSlots.banners} ${
                template.imageSlots.banners === 1 ? "imagem" : "imagens, na ordem da lista"
              }. JPG, PNG, WebP ou HEIC, otimizadas antes do envio.`}
              paths={field.value}
              max={template.imageSlots.banners}
              onChange={field.onChange}
              target={uploadTarget}
              disabled={disabled}
            />
          )}
        />
      ) : null}

      {identity.logoPath ? (
        <FieldDescription>
          Prévia do logo enviado:{" "}
          <a
            href={getLandingAssetPublicUrl(identity.logoPath) ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            abrir imagem
          </a>
        </FieldDescription>
      ) : null}
    </FieldGroup>
  )
}
