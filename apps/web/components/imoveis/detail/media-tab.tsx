import Link from "next/link"
import { ExternalLinkIcon, ImageIcon, ImagesIcon, Rotate3dIcon, VideoIcon } from "lucide-react"

import { AspectRatio } from "@workspace/ui/components/aspect-ratio"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { PropertyCover } from "@/components/imoveis/property-cover"
import type { MediaSummary } from "@/lib/imoveis/mappers"

export function MediaTab({
  propertyId,
  propertyCode,
  media,
  canEdit,
}: {
  propertyId: string
  propertyCode: string
  media: MediaSummary
  canEdit: boolean
}) {
  const manageHref = `/imoveis/${propertyId}/editar?etapa=midia`
  const links = [
    media.videoUrl
      ? {
          key: "video",
          title: "Vídeo (YouTube)",
          url: media.videoUrl,
          icon: VideoIcon,
        }
      : null,
    media.tourUrl
      ? {
          key: "tour",
          title: "Tour virtual",
          url: media.tourUrl,
          icon: Rotate3dIcon,
        }
      : null,
  ].filter((item) => item !== null)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Fotos</CardTitle>
            <CardDescription>
              {media.photosCount === 1
                ? "1 foto, na ordem do anúncio."
                : `${media.photosCount} fotos, na ordem do anúncio.`}
            </CardDescription>
          </div>
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={manageHref} />}
              nativeButton={false}
            >
              <ImagesIcon data-icon="inline-start" />
              Gerenciar mídia
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {media.images.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma foto cadastrada</EmptyTitle>
                <EmptyDescription>
                  Anúncios com boas fotos recebem mais contatos e melhoram a Nota do Anúncio.
                </EmptyDescription>
              </EmptyHeader>
              {canEdit ? (
                <EmptyContent>
                  <Button render={<Link href={manageHref} />} nativeButton={false}>
                    <ImagesIcon data-icon="inline-start" />
                    Enviar fotos
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {media.images.map((image, index) => (
                <li key={image.id}>
                  <figure className="flex flex-col gap-1.5">
                    <AspectRatio ratio={4 / 3} className="overflow-hidden rounded-md">
                      <PropertyCover
                        storagePath={image.storage_path}
                        alt={image.caption || `Foto ${index + 1} do imóvel ${propertyCode}`}
                        variant="responsive"
                        sizes="(min-width: 1280px) 16rem, (min-width: 640px) 33vw, 50vw"
                        className="size-full"
                      />
                      {image.is_cover ? (
                        <Badge className="absolute inset-s-2 top-2">Capa</Badge>
                      ) : null}
                    </AspectRatio>
                    {image.caption ? (
                      <figcaption className="line-clamp-2 text-xs text-muted-foreground">
                        {image.caption}
                      </figcaption>
                    ) : null}
                  </figure>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vídeo e tour virtual</CardTitle>
          <CardDescription>Links externos exibidos nos portais.</CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum vídeo ou tour virtual cadastrado.
            </p>
          ) : (
            <ItemGroup className="gap-2">
              {links.map((link) => (
                <Item
                  key={link.key}
                  variant="outline"
                  size="sm"
                  render={<a href={link.url} target="_blank" rel="noopener noreferrer" />}
                >
                  <ItemMedia variant="icon">
                    <link.icon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{link.title}</ItemTitle>
                    <ItemDescription className="truncate">{link.url}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ExternalLinkIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">(abre em nova aba)</span>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
