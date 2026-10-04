"use client"

import * as React from "react"
import {
  CalendarClockIcon,
  DownloadIcon,
  FileTextIcon,
  LockIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react"

import { formatBytes } from "@workspace/core/media/format"
import { detectFileKind } from "@workspace/core/media/image-type"
import {
  getPropertyDocumentValidity,
  isPropertyDocumentKind,
  isPropertyDocumentMimeType,
  PROPERTY_DOCUMENT_DESCRIPTION_MAX_LENGTH,
  PROPERTY_DOCUMENT_KIND_LABELS,
  PROPERTY_DOCUMENT_KIND_VALUES,
  PROPERTY_DOCUMENT_MAX_BYTES,
  PROPERTY_DOCUMENTS_BUCKET,
  type PropertyDocumentKind,
  type PropertyDocumentMimeType,
  type PropertyDocumentValidity,
} from "@workspace/core/properties/documents"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { formatDateOnly } from "@/components/imoveis/detail/format"
import type { PropertyDocumentItem } from "@/components/imoveis/detail/types"
import { UploadsBlockedNotice } from "@/components/media/uploads-blocked-notice"
import { formatDate } from "@/lib/format"
import {
  deletePropertyDocumentAction,
  getPropertyDocumentDownloadUrlAction,
  registerPropertyDocumentAction,
  requestPropertyDocumentUploadAction,
} from "@/lib/imoveis/document-actions"
import { getImagePreparationMessage, prepareImage } from "@/lib/media/compress-image"
import { isStorageForbiddenError, UPLOADS_BLOCKED_MESSAGE } from "@/lib/media/upload-errors"
import { uploadWithTicket } from "@/lib/storage/signed-upload-client"

/** PDF e imagens; HEIC do iPhone é aceito e convertido para JPEG. */
const FILE_ACCEPT = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".pdf",
  ".heic",
  ".heif",
].join(",")

const KIND_ITEMS = PROPERTY_DOCUMENT_KIND_VALUES.map((kind) => ({
  label: PROPERTY_DOCUMENT_KIND_LABELS[kind],
  value: kind as string | null,
}))

function mimeLabel(mimeType: string) {
  return mimeType === "application/pdf" ? "PDF" : "Imagem"
}

function ValidityBadge({ validity }: { validity: PropertyDocumentValidity }) {
  switch (validity.state) {
    case "expired":
      return <Badge variant="destructive">Vencido</Badge>
    case "expiring":
      return (
        <Badge variant="secondary">
          {validity.daysLeft === 0
            ? "Vence hoje"
            : `Vence em ${validity.daysLeft} dia${validity.daysLeft === 1 ? "" : "s"}`}
        </Badge>
      )
    case "valid":
      return <Badge variant="outline">Válido</Badge>
    default:
      return null
  }
}

type PreparedFile = { blob: Blob; mimeType: PropertyDocumentMimeType }

/**
 * PDF passa sem alteração (até 10 MB). Imagem vira JPEG legível e perde
 * EXIF/GPS no reencode (LGPD).
 */
async function prepareFile(
  file: File
): Promise<{ ok: true; file: PreparedFile } | { ok: false; error: string }> {
  if (detectFileKind(file) === "pdf") {
    if (file.size === 0) return { ok: false, error: "O arquivo está vazio." }
    if (file.size > PROPERTY_DOCUMENT_MAX_BYTES) {
      return {
        ok: false,
        error: `O PDF tem ${formatBytes(file.size)}; o limite é ${formatBytes(PROPERTY_DOCUMENT_MAX_BYTES)}. Gere uma versão reduzida e envie de novo.`,
      }
    }
    return { ok: true, file: { blob: file, mimeType: "application/pdf" } }
  }

  try {
    const { main } = await prepareImage(file, "clientDocumentImage")

    if (!isPropertyDocumentMimeType(main.type) || main.bytes > PROPERTY_DOCUMENT_MAX_BYTES) {
      return {
        ok: false,
        error: "Não foi possível otimizar esta imagem. Salve-a em JPEG e tente de novo.",
      }
    }

    return { ok: true, file: { blob: main.blob, mimeType: main.type } }
  } catch (error) {
    return { ok: false, error: getImagePreparationMessage(error) }
  }
}

function UploadDocumentDialog({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<PropertyDocumentKind | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [validUntil, setValidUntil] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [errors, setErrors] = React.useState<{ kind?: string; file?: string; form?: string }>({})
  const [progress, setProgress] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    setKind(null)
    setFile(null)
    setValidUntil("")
    setDescription("")
    setErrors({})
    setProgress(null)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors: typeof errors = {}
    if (!kind) nextErrors.kind = "Escolha o tipo do documento."
    if (!file) nextErrors.file = "Escolha o arquivo."
    setErrors(nextErrors)
    if (!kind || !file) return

    startTransition(async () => {
      setProgress("Preparando o arquivo…")
      const prepared = await prepareFile(file)

      if (!prepared.ok) {
        setProgress(null)
        setErrors({ file: prepared.error })
        return
      }

      const { blob, mimeType } = prepared.file

      setProgress(`Enviando (${formatBytes(blob.size)})…`)
      // O servidor confere a permissão, escolhe o caminho e devolve o token de envio.
      const ticket = await requestPropertyDocumentUploadAction(propertyId, {
        mimeType,
        sizeBytes: blob.size,
      })

      if (!ticket.ok) {
        setProgress(null)
        setErrors({ form: ticket.error })
        return
      }

      const path = ticket.data.path
      const { error: uploadError } = await uploadWithTicket(
        PROPERTY_DOCUMENTS_BUCKET,
        ticket.data,
        blob,
        { contentType: mimeType }
      )

      if (uploadError) {
        setProgress(null)
        setErrors({
          form: isStorageForbiddenError(uploadError)
            ? UPLOADS_BLOCKED_MESSAGE
            : "Falha no envio. Verifique a conexão e tente de novo.",
        })
        return
      }

      const result = await registerPropertyDocumentAction(propertyId, {
        storagePath: path,
        kind,
        description,
        validUntil,
        mimeType,
        sizeBytes: blob.size,
      })

      setProgress(null)

      if (!result.ok) {
        // A Server Action apaga o arquivo sem registro: não fica órfão no bucket.
        setErrors({ form: result.error })
        return
      }

      toast.add({ title: result.message ?? "Documento enviado.", type: "success" })
      setOpen(false)
      reset()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <UploadIcon data-icon="inline-start" />
        Adicionar documento
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar documento</DialogTitle>
          <DialogDescription>
            PDF até 10 MB ou foto (JPG, PNG, WebP ou HEIC). O arquivo fica privado e é guardado com
            nome aleatório.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <FieldGroup>
            {errors.form ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Não foi possível enviar</AlertTitle>
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={errors.kind ? true : undefined}>
              <FieldLabel htmlFor="documento-tipo">Tipo</FieldLabel>
              <Select
                items={KIND_ITEMS}
                value={kind}
                onValueChange={(value: string | null) =>
                  setKind(isPropertyDocumentKind(value) ? value : null)
                }
                disabled={isPending}
              >
                <SelectTrigger
                  id="documento-tipo"
                  className="w-full"
                  aria-invalid={errors.kind ? true : undefined}
                >
                  <SelectValue placeholder="Escolha o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {KIND_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {errors.kind ? <FieldError errors={[{ message: errors.kind }]} /> : null}
            </Field>
            <Field data-invalid={errors.file ? true : undefined}>
              <FieldLabel htmlFor="documento-arquivo">Arquivo</FieldLabel>
              <Input
                id="documento-arquivo"
                type="file"
                accept={FILE_ACCEPT}
                disabled={isPending}
                aria-invalid={errors.file ? true : undefined}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setErrors((current) => ({ ...current, file: undefined }))
                }}
              />
              {errors.file ? (
                <FieldError errors={[{ message: errors.file }]} />
              ) : (
                <FieldDescription>
                  Fotos são otimizadas no navegador e perdem os dados de localização.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="documento-validade">Validade (opcional)</FieldLabel>
              <Input
                id="documento-validade"
                type="date"
                value={validUntil}
                disabled={isPending}
                onChange={(event) => setValidUntil(event.target.value)}
              />
              <FieldDescription>
                Certidões e IPTU vencem: a ficha avisa 30 dias antes e marca como vencido depois.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="documento-descricao">Descrição (opcional)</FieldLabel>
              <Input
                id="documento-descricao"
                value={description}
                maxLength={PROPERTY_DOCUMENT_DESCRIPTION_MAX_LENGTH}
                placeholder="Ex.: Certidão de ônus reais"
                disabled={isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {progress ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {progress}
              </p>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isPending} />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Enviar documento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDocumentButton({
  propertyId,
  document,
}: {
  propertyId: string
  document: PropertyDocumentItem
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const label = PROPERTY_DOCUMENT_KIND_LABELS[document.kind]

  function confirm() {
    startTransition(async () => {
      const result = await deletePropertyDocumentAction(propertyId, document.id)

      if (!result.ok) {
        toast.add({ title: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Documento removido.", type: "success" })
      setOpen(false)
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Trash2Icon />
        <span className="sr-only">Remover {label}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover este documento?</AlertDialogTitle>
          <AlertDialogDescription>
            {label}
            {document.description ? ` (${document.description})` : ""} sai do dossiê e o arquivo é
            apagado. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DocumentsTab({
  propertyId,
  documents,
  today,
  canManage,
  uploadsBlocked,
}: {
  /** Não é mais usado: o caminho do arquivo é decidido no servidor. */
  organizationId?: string
  propertyId: string
  documents: PropertyDocumentItem[]
  /** AAAA-MM-DD em São Paulo, calculado no servidor. */
  today: string
  /** Dono, gerente, captador ou corretor responsável: envia e remove. */
  canManage: boolean
  uploadsBlocked: boolean
}) {
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null)
  const [isDownloading, startDownload] = React.useTransition()

  const rows = documents.map((document) => ({
    document,
    validity: getPropertyDocumentValidity(document.validUntil, today),
  }))
  const expired = rows.filter((row) => row.validity.state === "expired").length
  const expiring = rows.filter((row) => row.validity.state === "expiring").length

  function download(documentId: string) {
    setDownloadingId(documentId)

    startDownload(async () => {
      const result = await getPropertyDocumentDownloadUrlAction(propertyId, documentId)
      setDownloadingId(null)

      if (!result.ok) {
        toast.add({ title: result.error, type: "error" })
        return
      }

      // URL assinada com Content-Disposition de download: não sai da página.
      window.location.assign(result.url)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {expired > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {expired === 1 ? "1 documento vencido" : `${expired} documentos vencidos`}
          </AlertTitle>
          <AlertDescription>
            Peça a versão atualizada antes de enviar o dossiê ao comprador.
          </AlertDescription>
        </Alert>
      ) : expiring > 0 ? (
        <Alert variant="warning">
          <CalendarClockIcon />
          <AlertTitle>
            {expiring === 1
              ? "1 documento vence nos próximos 30 dias"
              : `${expiring} documentos vencem nos próximos 30 dias`}
          </AlertTitle>
          <AlertDescription>Programe a renovação para não atrasar a negociação.</AlertDescription>
        </Alert>
      ) : null}

      {canManage && uploadsBlocked ? <UploadsBlockedNotice /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Dossiê do imóvel</CardTitle>
          <CardDescription>
            Matrícula, IPTU, planta, habite-se, certidões e contrato de autorização.
          </CardDescription>
          {canManage && !uploadsBlocked ? (
            <CardAction>
              <UploadDocumentDialog propertyId={propertyId} />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Arquivos privados: cada download usa um link temporário e fica registrado com o seu
            usuário.
          </p>
          {rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhum documento no dossiê</EmptyTitle>
                <EmptyDescription>
                  {canManage
                    ? "Envie a matrícula, o IPTU e as certidões para agilizar a diligência do comprador."
                    : "O dono, o gerente, o captador ou o corretor responsável enviam os documentos."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {rows.map(({ document, validity }) => (
                <Item key={document.id} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="flex-wrap">
                      {PROPERTY_DOCUMENT_KIND_LABELS[document.kind]}
                      <ValidityBadge validity={validity} />
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {document.description ? `${document.description} · ` : ""}
                      {document.validUntil
                        ? `${validity.state === "expired" ? "Venceu em" : "Válido até"} ${formatDateOnly(document.validUntil)} · `
                        : ""}
                      {mimeLabel(document.mimeType)} · {formatBytes(document.sizeBytes)} · Enviado
                      por {document.uploadedByName} em {formatDate(document.createdAt)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => download(document.id)}
                      disabled={isDownloading}
                    >
                      {isDownloading && downloadingId === document.id ? (
                        <Spinner />
                      ) : (
                        <DownloadIcon />
                      )}
                      <span className="sr-only">
                        Baixar {PROPERTY_DOCUMENT_KIND_LABELS[document.kind]}
                      </span>
                    </Button>
                    {canManage ? (
                      <DeleteDocumentButton propertyId={propertyId} document={document} />
                    ) : null}
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
