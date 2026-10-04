"use client"

import { ImagePlusIcon, SaveIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"

import { PropertyMediaManager } from "@/components/imoveis/property-media-manager"
import { TextField, type PropertyFormControl } from "@/components/imoveis/property-form/fields"
import type { PropertySummary } from "@/components/imoveis/property-form/types"
import type { MediaSource } from "@/lib/imoveis/mappers"

export function StepMidia({
  control,
  organizationId,
  property,
  media,
  canDeleteMedia,
  uploadsBlocked,
  isSaving,
  onSaveDraft,
}: {
  control: PropertyFormControl
  organizationId: string
  property: PropertySummary | null
  media: readonly MediaSource[]
  canDeleteMedia: boolean
  uploadsBlocked: boolean
  isSaving: boolean
  onSaveDraft: () => void
}) {
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Fotos</FieldLegend>
        {property ? (
          <PropertyMediaManager
            organizationId={organizationId}
            propertyId={property.id}
            media={media}
            canDelete={canDeleteMedia}
            uploadsBlocked={uploadsBlocked}
          />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImagePlusIcon />
              </EmptyMedia>
              <EmptyTitle>Salve o rascunho para enviar fotos</EmptyTitle>
              <EmptyDescription>
                As fotos ficam na pasta do imóvel, criada no primeiro salvamento. Salve agora como
                rascunho (só o título é obrigatório) e continue daqui.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" onClick={onSaveDraft} disabled={isSaving}>
                {isSaving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                Salvar rascunho e enviar fotos
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Vídeo e tour virtual</FieldLegend>
        <FieldDescription>
          Um vídeo ou um tour vale 10 pontos na Nota do Anúncio. São salvos junto com o imóvel.
        </FieldDescription>
        <TextField
          control={control}
          name="videoUrl"
          label="Vídeo do YouTube"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=..."
          description="Somente links do YouTube (youtube.com ou youtu.be)."
        />
        <TextField
          control={control}
          name="tourUrl"
          label="Tour virtual"
          type="url"
          inputMode="url"
          placeholder="https://..."
          description="Link https do tour 360° (Matterport, Kuula e similares)."
        />
      </FieldSet>
    </FieldGroup>
  )
}
