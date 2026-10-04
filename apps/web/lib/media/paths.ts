import { buildPhotoSrcSet, getThumbUrl, thumbPathFor } from "@workspace/core/media/paths"

import { getPropertyMediaPublicUrl } from "@/lib/imoveis/media-url"

// Convenção (sem coluna no banco): a miniatura WebP de 400 px fica ao lado da
// foto principal, com o mesmo nome base e o sufixo `__thumb.webp`. Fotos
// antigas não têm miniatura; a UI cai para a principal (FallbackImage).
export {
  MAIN_PHOTO_WIDTH,
  THUMB_SUFFIX,
  THUMB_WIDTH,
  buildPhotoSrcSet,
  getThumbUrl,
  isThumbPath,
  thumbPathFor,
} from "@workspace/core/media/paths"

/** Objetos do Storage de uma foto: a principal e a miniatura (apagar os dois). */
export function propertyPhotoObjectPaths(storagePath: string) {
  const thumbPath = thumbPathFor(storagePath)
  return thumbPath === storagePath ? [storagePath] : [storagePath, thumbPath]
}

/** URLs públicas de uma foto do bucket property-media. */
export function getPropertyPhotoUrls(storagePath: string | null | undefined) {
  const main = getPropertyMediaPublicUrl(storagePath)
  return {
    main,
    thumb: getThumbUrl(main),
    srcSet: buildPhotoSrcSet(main),
  }
}
