"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  ImagePlusIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import { formatSizeChange } from "@workspace/core/media/format"
import { SOURCE_IMAGE_ACCEPT, detectFileKind } from "@workspace/core/media/image-type"
import { MAX_PROPERTY_PHOTOS, splitByPhotoLimit } from "@workspace/core/media/limits"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Kbd } from "@workspace/ui/components/kbd"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { cn } from "@workspace/ui/lib/utils"

import { FallbackImage } from "@/components/media/fallback-image"
import { UploadsBlockedNotice } from "@/components/media/uploads-blocked-notice"
import type { ActionResult } from "@/lib/auth/action-result"
import { CAPTION_MAX_LENGTH, MAX_IMAGE_BYTES, PROPERTY_MEDIA_BUCKET } from "@/lib/imoveis/constants"
import { translateStorageError } from "@/lib/imoveis/db-errors"
import {
  registerPropertyImagesAction,
  removeMediaAction,
  reorderMediaAction,
  requestPropertyPhotoUploadAction,
  setCoverMediaAction,
  updateMediaCaptionAction,
} from "@/lib/imoveis/media-actions"
import type { MediaSource } from "@/lib/imoveis/mappers"
import { REMOVE_MEDIA_DENIED_MESSAGE } from "@/lib/imoveis/permissions"
import { getImagePreparationMessage, prepareImage } from "@/lib/media/compress-image"
import { getPropertyPhotoUrls } from "@/lib/media/paths"
import { UPLOADS_BLOCKED_MESSAGE, isStorageForbiddenError } from "@/lib/media/upload-errors"
import { uploadWithTicket } from "@/lib/storage/signed-upload-client"

/** Otimizar e enviar no máximo 2 fotos ao mesmo tempo: não trava o celular. */
const UPLOAD_CONCURRENCY = 2
const STORAGE_CACHE_CONTROL = "31536000"
const PHOTO_SIZES = "(min-width: 1280px) 20rem, (min-width: 640px) 50vw, 100vw"
const DRAG_MEDIA_TYPE = "application/x-imob-foto"
const REORDER_HELP_ID = "fotos-reordenar-ajuda"

type UploadStatus = "queued" | "optimizing" | "uploading" | "error"

type UploadEntry = {
  key: string
  name: string
  status: UploadStatus
  /** "2,8 MB → 240 KB" depois da otimização. */
  sizeLabel?: string
  error?: string
}

const STATUS_LABELS: Record<Exclude<UploadStatus, "error">, string> = {
  queued: "Na fila…",
  optimizing: "Otimizando…",
  uploading: "Enviando…",
}

function notify(result: ActionResult, { quiet = false }: { quiet?: boolean } = {}) {
  if (!result.ok) {
    toast.add({
      type: "error",
      title: "Não foi possível concluir",
      description: result.error,
    })
  } else if (!quiet && result.message) {
    toast.add({ type: "success", title: result.message })
  }
}

/** Nova ordem com `id` na posição `to` (os demais deslizam). */
function moveInOrder(ids: readonly string[], id: string, to: number) {
  const from = ids.indexOf(id)
  if (from < 0) return [...ids]

  const target = Math.min(Math.max(to, 0), ids.length - 1)
  if (from === target) return [...ids]

  const next = [...ids]
  next.splice(from, 1)
  next.splice(target, 0, id)
  return next
}

type MediaCardProps = {
  propertyId: string
  image: MediaSource
  index: number
  total: number
  canDelete: boolean
  isGrabbed: boolean
  isDragging: boolean
  reordering: boolean
  onMove: (id: string, to: number) => void
  onGrabToggle: (id: string) => void
  onCancelGrab: () => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragEnterIndex: (index: number) => void
}

function MediaCard({
  propertyId,
  image,
  index,
  total,
  canDelete,
  isGrabbed,
  isDragging,
  reordering,
  onMove,
  onGrabToggle,
  onCancelGrab,
  onDragStart,
  onDragEnd,
  onDragEnterIndex,
}: MediaCardProps) {
  const [caption, setCaption] = React.useState(image.caption ?? "")
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const cardRef = React.useRef<HTMLDivElement>(null)
  const photo = getPropertyPhotoUrls(image.storage_path)
  const captionChanged = caption.trim() !== (image.caption ?? "")
  const label = `Foto ${index + 1}`
  const position = `posição ${index + 1} de ${total}`

  function run(action: () => Promise<ActionResult>, options?: { quiet?: boolean }) {
    startTransition(async () => {
      notify(await action(), options)
    })
  }

  function saveCaption() {
    if (!captionChanged) return
    run(() => updateMediaCaptionAction(propertyId, image.id, caption))
  }

  function handleHandleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      onGrabToggle(image.id)
      return
    }

    if (!isGrabbed) return

    if (event.key === "Escape") {
      event.preventDefault()
      onCancelGrab()
      return
    }

    const step =
      event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? 1
          : event.key === "Home"
            ? -index
            : event.key === "End"
              ? total - 1 - index
              : 0

    if (step === 0) return
    event.preventDefault()
    onMove(image.id, index + step)
  }

  return (
    <Card
      ref={cardRef}
      size="sm"
      data-grabbed={isGrabbed || undefined}
      className={cn(
        "h-full transition-opacity",
        isDragging && "opacity-50",
        isGrabbed && "ring-2 ring-ring"
      )}
      onDragEnter={() => onDragEnterIndex(index)}
      onDragOver={(event) => {
        // Sem preventDefault o navegador recusa a soltura neste alvo.
        if (event.dataTransfer.types.includes(DRAG_MEDIA_TYPE)) event.preventDefault()
      }}
    >
      {photo.main ? (
        <FallbackImage
          src={photo.main}
          srcSet={photo.srcSet}
          sizes={PHOTO_SIZES}
          fallbackSrc={photo.main}
          alt={image.caption || label}
          width={1600}
          height={1200}
          loading="lazy"
          decoding="async"
          className="aspect-4/3 w-full object-cover"
        />
      ) : null}
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardAction>
          {image.is_cover ? (
            <Badge>
              <StarIcon data-icon="inline-start" />
              Capa
            </Badge>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor={`legenda-${image.id}`} className="sr-only">
            Legenda da {label.toLowerCase()}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`legenda-${image.id}`}
              value={caption}
              maxLength={CAPTION_MAX_LENGTH}
              placeholder="Legenda (ex.: Sala com varanda)"
              disabled={isPending}
              onChange={(event) => setCaption(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  saveCaption()
                }
              }}
            />
            {captionChanged ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton onClick={saveCaption} disabled={isPending}>
                  Salvar
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </Field>
      </CardContent>
      <CardFooter className="flex-wrap gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          draggable={total > 1}
          aria-roledescription="botão de mover foto"
          aria-describedby={REORDER_HELP_ID}
          aria-pressed={isGrabbed}
          aria-label={`Mover ${label.toLowerCase()}, ${position}`}
          title="Arraste para reordenar (ou Espaço e setas)"
          disabled={total < 2}
          className="cursor-grab active:cursor-grabbing"
          onKeyDown={handleHandleKeyDown}
          onBlur={() => {
            if (isGrabbed) onGrabToggle(image.id)
          }}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move"
            event.dataTransfer.setData(DRAG_MEDIA_TYPE, image.id)
            if (cardRef.current) event.dataTransfer.setDragImage(cardRef.current, 24, 24)
            onDragStart(image.id)
          }}
          onDragEnd={onDragEnd}
        >
          <GripVerticalIcon />
          <span className="sr-only">
            {isGrabbed ? "Soltar" : "Mover"} {label.toLowerCase()}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Subir"
          disabled={isPending || reordering || index === 0}
          onClick={() => onMove(image.id, index - 1)}
        >
          <ArrowUpIcon />
          <span className="sr-only">Subir {label.toLowerCase()}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Descer"
          disabled={isPending || reordering || index === total - 1}
          onClick={() => onMove(image.id, index + 1)}
        >
          <ArrowDownIcon />
          <span className="sr-only">Descer {label.toLowerCase()}</span>
        </Button>
        {image.is_cover ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => run(() => setCoverMediaAction(propertyId, image.id))}
          >
            <StarIcon data-icon="inline-start" />
            Definir capa
          </Button>
        )}
        {canDelete ? (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger
              render={<Button type="button" variant="ghost" size="sm" disabled={isPending} />}
            >
              <Trash2Icon data-icon="inline-start" />
              Remover
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover a {label.toLowerCase()}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A foto sai do anúncio e o arquivo é apagado do armazenamento. Não dá para
                  desfazer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    setConfirmOpen(false)
                    run(() => removeMediaAction(propertyId, image.id))
                  }}
                >
                  Remover foto
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {isPending ? <Spinner className="ms-auto" /> : null}
      </CardFooter>
    </Card>
  )
}

/**
 * Fotos do imóvel. Cada arquivo é otimizado no navegador (JPEG de até 1600 px,
 * sem EXIF/GPS) e ganha uma miniatura WebP de 400 px (`__thumb.webp`). Depois
 * uma Server Action confere a edição do imóvel e o limite de fotos e devolve
 * tokens de envio (URL assinada); o navegador envia sem sessão ao bucket
 * property-media. O registro no banco (que confere tamanho e tipo gravados)
 * também é Server Action.
 *
 * A ordem muda arrastando o botão de mover (ou, pelo teclado, Espaço para pegar
 * e setas para mover). A lista reage na hora e a ordem inteira é gravada de uma
 * vez por `reorderMediaAction`; se o banco recusar, ela volta ao que estava.
 */
export function PropertyMediaManager({
  propertyId,
  media,
  canDelete,
  uploadsBlocked = false,
}: {
  /** Não é mais usado: o caminho do arquivo é decidido no servidor. */
  organizationId?: string
  propertyId: string
  media: readonly MediaSource[]
  canDelete: boolean
  /** Assinatura em modo leitura: o Storage recusa novos arquivos. */
  uploadsBlocked?: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = React.useState<UploadEntry[]>([])
  const [summary, setSummary] = React.useState<string | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  const serverImages = React.useMemo(
    () =>
      media
        .filter((item) => item.kind === "image" && item.storage_path)
        .sort((a, b) => a.position - b.position),
    [media]
  )
  const serverOrderKey = serverImages.map((image) => image.id).join(",")

  /**
   * Ordem otimista enquanto a gravação não volta. Fica guardada com a ordem do
   * servidor de que saiu (`key`): quando a revalidação traz posições novas a
   * chave muda, a ordem local deixa de valer sozinha e não é preciso efeito
   * nenhum para limpá-la.
   */
  const [pendingOrder, setPendingOrder] = React.useState<{ key: string; ids: string[] } | null>(
    null
  )
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [grabbedId, setGrabbedId] = React.useState<string | null>(null)
  const [reorderStatus, setReorderStatus] = React.useState("")
  const [isReordering, startReorder] = React.useTransition()
  const orderBeforeGrab = React.useRef<string[] | null>(null)
  const orderBeforeDrag = React.useRef<string[] | null>(null)

  const localOrder = pendingOrder?.key === serverOrderKey ? pendingOrder.ids : null

  function applyOrder(ids: string[] | null) {
    setPendingOrder(ids ? { key: serverOrderKey, ids } : null)
  }

  const images = React.useMemo(() => {
    if (!localOrder) return serverImages

    const byId = new Map(serverImages.map((image) => [image.id, image]))
    const ordered = localOrder
      .map((id) => byId.get(id))
      .filter((image): image is MediaSource => image !== undefined)
    const placed = new Set(ordered.map((image) => image.id))

    for (const image of serverImages) {
      if (!placed.has(image.id)) ordered.push(image)
    }

    return ordered
  }, [serverImages, localOrder])

  const imageIds = images.map((image) => image.id)
  const isUploading = uploads.some((entry) => entry.status !== "error")
  const isFull = images.length >= MAX_PROPERTY_PHOTOS
  const canAdd = !uploadsBlocked && !isFull

  function announceMove(id: string, ids: readonly string[]) {
    const position = ids.indexOf(id) + 1
    setReorderStatus(`Foto movida para a posição ${position} de ${ids.length}.`)
  }

  function persistOrder(ids: string[]) {
    startReorder(async () => {
      const result = await reorderMediaAction(propertyId, ids)
      if (!result.ok) {
        applyOrder(null)
        setReorderStatus("A ordem das fotos não foi salva.")
        notify(result)
      }
    })
  }

  /** Move na tela na hora; grava só quando a foto é solta. */
  function previewMove(id: string, to: number) {
    const next = moveInOrder(localOrder ?? imageIds, id, to)
    applyOrder(next)
    announceMove(id, next)
  }

  function moveAndSave(id: string, to: number) {
    const next = moveInOrder(localOrder ?? imageIds, id, to)
    applyOrder(next)
    announceMove(id, next)
    persistOrder(next)
  }

  function startDrag(id: string) {
    orderBeforeDrag.current = [...(localOrder ?? imageIds)]
    setDraggingId(id)
  }

  /** Vale para soltar na lista e para desistir: dragend sempre acontece. */
  function endDrag() {
    const current = localOrder ?? imageIds
    if (orderBeforeDrag.current && orderBeforeDrag.current.join(",") !== current.join(",")) {
      persistOrder([...current])
    }
    orderBeforeDrag.current = null
    setDraggingId(null)
  }

  function toggleGrab(id: string) {
    if (grabbedId === id) {
      setGrabbedId(null)
      const current = localOrder ?? imageIds
      if (orderBeforeGrab.current?.join(",") !== current.join(",")) {
        persistOrder([...current])
        setReorderStatus(`Foto solta na posição ${current.indexOf(id) + 1} de ${current.length}.`)
      }
      orderBeforeGrab.current = null
      return
    }

    orderBeforeGrab.current = [...(localOrder ?? imageIds)]
    setGrabbedId(id)
    setReorderStatus(
      `Foto pega na posição ${(localOrder ?? imageIds).indexOf(id) + 1} de ${images.length}. Use as setas para mover, Enter para soltar e Esc para cancelar.`
    )
  }

  function cancelGrab() {
    applyOrder(orderBeforeGrab.current)
    setGrabbedId(null)
    orderBeforeGrab.current = null
    setReorderStatus("Movimentação cancelada: a ordem voltou ao que estava.")
  }

  function updateEntry(key: string, patch: Partial<UploadEntry>) {
    setUploads((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry))
    )
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || isUploading) return

    if (uploadsBlocked) {
      toast.add({ type: "error", title: "Envio bloqueado", description: UPLOADS_BLOCKED_MESSAGE })
      return
    }

    const rejected: string[] = []
    const candidates: { file: File; key: string }[] = []

    for (const file of files) {
      const kind = detectFileKind(file)
      // Formato desconhecido segue: a assinatura do arquivo é conferida na otimização.
      if (kind === "svg" || kind === "pdf") {
        rejected.push(`${file.name}: formato não aceito (use JPG, PNG, WebP ou HEIC)`)
      } else {
        candidates.push({ file, key: crypto.randomUUID() })
      }
    }

    const limit = splitByPhotoLimit(images.length, candidates.length)
    const accepted = candidates.slice(0, limit.accepted)

    if (limit.rejected > 0) {
      rejected.push(
        limit.remaining === 0
          ? `o imóvel já tem ${MAX_PROPERTY_PHOTOS} fotos, o máximo permitido`
          : `${limit.rejected === 1 ? "1 foto ficou" : `${limit.rejected} fotos ficaram`} de fora: o máximo é ${MAX_PROPERTY_PHOTOS} por imóvel`
      )
    }

    if (rejected.length > 0) {
      const ignored = files.length - accepted.length
      toast.add({
        type: "error",
        title: ignored === 1 ? "Um arquivo foi ignorado" : `${ignored} arquivos foram ignorados`,
        description: rejected.join("; "),
      })
    }
    if (accepted.length === 0) return

    setSummary(null)
    setUploads(accepted.map(({ file, key }) => ({ key, name: file.name, status: "queued" })))

    const uploadedPaths: (string | null)[] = accepted.map(() => null)
    const failures = new Map<string, string>()
    let beforeBytes = 0
    let afterBytes = 0
    let blocked = false
    let next = 0

    async function processEntry(index: number) {
      const entry = accepted[index]
      if (!entry) return

      if (blocked) {
        failures.set(entry.key, UPLOADS_BLOCKED_MESSAGE)
        return
      }

      updateEntry(entry.key, { status: "optimizing" })

      let prepared: Awaited<ReturnType<typeof prepareImage>>
      try {
        prepared = await prepareImage(entry.file, "propertyPhoto", { thumbnail: true })
      } catch (error) {
        failures.set(entry.key, getImagePreparationMessage(error))
        return
      }

      const { main, thumb } = prepared
      if (main.bytes > MAX_IMAGE_BYTES) {
        failures.set(entry.key, "Mesmo otimizada, a foto passou do limite. Tente outra foto.")
        return
      }

      updateEntry(entry.key, {
        status: "uploading",
        sizeLabel: formatSizeChange(entry.file.size, main.bytes),
      })

      // Token pedido só agora (depois da otimização): o caminho vem do servidor.
      const tickets = await requestPropertyPhotoUploadAction(propertyId, {
        extension: main.extension,
        thumbnail: Boolean(thumb),
      })

      if (!tickets.ok) {
        if (tickets.blocked) blocked = true
        failures.set(entry.key, tickets.error)
        return
      }

      const path = tickets.data.main.path
      const { error } = await uploadWithTicket(
        PROPERTY_MEDIA_BUCKET,
        tickets.data.main,
        main.blob,
        {
          contentType: main.type,
          cacheControl: STORAGE_CACHE_CONTROL,
        }
      )

      if (error) {
        if (isStorageForbiddenError(error)) {
          blocked = true
          failures.set(entry.key, UPLOADS_BLOCKED_MESSAGE)
        } else {
          failures.set(entry.key, translateStorageError(error, "enviar fotos para este imóvel"))
        }
        return
      }

      uploadedPaths[index] = path
      beforeBytes += entry.file.size
      afterBytes += main.bytes

      if (thumb && tickets.data.thumb) {
        // Sem miniatura a UI usa a foto principal; não vale perder a foto por isso.
        await uploadWithTicket(PROPERTY_MEDIA_BUCKET, tickets.data.thumb, thumb.blob, {
          contentType: thumb.type,
          cacheControl: STORAGE_CACHE_CONTROL,
        })
      }
    }

    async function worker() {
      while (next < accepted.length) {
        const index = next
        next += 1
        const entry = accepted[index]
        try {
          await processEntry(index)
        } catch {
          if (entry) failures.set(entry.key, "Falha no envio. Verifique a conexão e tente de novo.")
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, accepted.length) }, () => worker())
    )

    const paths = uploadedPaths.filter((path): path is string => path !== null)

    if (paths.length > 0) {
      // Se o registro falhar, a própria Server Action apaga os arquivos sem registro.
      const result = await registerPropertyImagesAction(propertyId, paths)
      if (result.ok) {
        setSummary(
          `${paths.length === 1 ? "1 foto otimizada" : `${paths.length} fotos otimizadas`}: ${formatSizeChange(beforeBytes, afterBytes)}`
        )
      }
      notify(result)
    }

    setUploads(
      accepted
        .filter(({ key }) => failures.has(key))
        .map(({ file, key }) => ({
          key,
          name: file.name,
          status: "error",
          error: failures.get(key),
        }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {uploadsBlocked ? <UploadsBlockedNotice /> : null}

      <div
        aria-disabled={!canAdd || undefined}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors",
          isDragging && canAdd && "border-primary bg-primary/5",
          !canAdd && "opacity-60"
        )}
        onDragOver={(event) => {
          // Reordenar não é envio: o arrastar de uma foto da lista não entra aqui.
          if (event.dataTransfer.types.includes(DRAG_MEDIA_TYPE)) return
          event.preventDefault()
          if (canAdd) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes(DRAG_MEDIA_TYPE)) return
          event.preventDefault()
          setIsDragging(false)
          if (!uploadsBlocked && isFull) {
            toast.add({
              type: "error",
              title: `Limite de ${MAX_PROPERTY_PHOTOS} fotos atingido`,
              description: "Remova uma foto para enviar outra.",
            })
            return
          }
          void uploadFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <ImagePlusIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            {isFull
              ? `Limite de ${MAX_PROPERTY_PHOTOS} fotos atingido`
              : "Arraste as fotos para cá"}
          </p>
          <p className="text-sm text-muted-foreground">
            {isFull
              ? "Remova uma foto para enviar outra."
              : "JPG, PNG, WebP ou HEIC. Cada foto é otimizada no navegador antes do envio (até 1600 px, sem dados de localização). Os portais exigem pelo menos 5 fotos; 15 ou mais pontuam o máximo na Nota do Anúncio."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isUploading || !canAdd}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon data-icon="inline-start" />
          )}
          {isUploading ? "Processando fotos…" : "Selecionar fotos"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={SOURCE_IMAGE_ACCEPT}
          multiple
          disabled={!canAdd}
          className="sr-only"
          tabIndex={-1}
          aria-label="Selecionar fotos do imóvel"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            void uploadFiles(files)
          }}
        />
      </div>

      {uploads.length > 0 ? (
        <ItemGroup className="gap-2" aria-live="polite">
          {uploads.map((entry) => (
            <Item key={entry.key} variant="outline" size="xs">
              <ItemMedia variant="icon">
                {entry.status === "error" ? (
                  <TriangleAlertIcon className="text-destructive" />
                ) : (
                  <Spinner />
                )}
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="truncate">{entry.name}</ItemTitle>
                <ItemDescription>
                  {entry.status === "error"
                    ? entry.error
                    : `${STATUS_LABELS[entry.status]}${entry.sizeLabel ? ` · ${entry.sizeLabel}` : ""}`}
                </ItemDescription>
              </ItemContent>
              {entry.status === "error" ? (
                <ItemActions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setUploads((current) => current.filter((item) => item.key !== entry.key))
                    }
                  >
                    <XIcon />
                    <span className="sr-only">Dispensar aviso de {entry.name}</span>
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          ))}
        </ItemGroup>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span aria-live="polite">
          {images.length} de {MAX_PROPERTY_PHOTOS} fotos
          {images.length < 5 ? ` · faltam ${5 - images.length} para o mínimo dos portais` : ""}
          {summary ? <span className="block text-xs tabular-nums">{summary}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          {isReordering ? <Spinner /> : null}
          {canDelete ? null : <span>{REMOVE_MEDIA_DENIED_MESSAGE}</span>}
        </span>
      </div>

      {images.length > 0 ? (
        <>
          {images.length > 1 ? (
            <p id={REORDER_HELP_ID} className="text-sm text-muted-foreground">
              A primeira foto é a que os portais mostram primeiro. Arraste pelo{" "}
              <GripVerticalIcon className="inline size-4 align-text-bottom" aria-hidden="true" />{" "}
              para reordenar. No teclado: chegue ao botão de mover, <Kbd>Espaço</Kbd> para pegar,{" "}
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> para mover, <Kbd>Enter</Kbd> para soltar e <Kbd>Esc</Kbd>{" "}
              para cancelar.
            </p>
          ) : null}
          <p aria-live="assertive" className="sr-only">
            {reorderStatus}
          </p>
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="Fotos do imóvel, em ordem de exibição"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(DRAG_MEDIA_TYPE)) event.preventDefault()
            }}
            onDrop={(event) => {
              // A ordem é gravada no dragend (que acontece mesmo fora da lista).
              if (event.dataTransfer.types.includes(DRAG_MEDIA_TYPE)) event.preventDefault()
            }}
          >
            {images.map((image, index) => (
              <li key={image.id}>
                <MediaCard
                  key={`${image.id}-${image.caption ?? ""}`}
                  propertyId={propertyId}
                  image={image}
                  index={index}
                  total={images.length}
                  canDelete={canDelete}
                  isGrabbed={grabbedId === image.id}
                  isDragging={draggingId === image.id}
                  reordering={isReordering}
                  onMove={grabbedId === image.id ? previewMove : moveAndSave}
                  onGrabToggle={toggleGrab}
                  onCancelGrab={cancelGrab}
                  onDragStart={startDrag}
                  onDragEnd={endDrag}
                  onDragEnterIndex={(target) => {
                    if (draggingId && draggingId !== image.id) previewMove(draggingId, target)
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
