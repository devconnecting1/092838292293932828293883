"use client"

import * as React from "react"
import { DownloadIcon, FileTextIcon, LockIcon, UploadIcon } from "lucide-react"

import { formatBytes, formatSizeChange } from "@workspace/core/media/format"
import { detectFileKind } from "@workspace/core/media/image-type"
import { CLIENT_DOCUMENT_PDF_MAX_BYTES } from "@workspace/core/media/limits"
import { replaceExtension } from "@workspace/core/media/paths"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/toast"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import { UploadsBlockedNotice } from "@/components/media/uploads-blocked-notice"
import { formatDateTime } from "@/lib/format"
import {
  CLIENT_DOCUMENT_MAX_BYTES,
  CLIENT_DOCUMENT_MIME_TYPES,
  CLIENT_DOCUMENTS_BUCKET,
} from "@/lib/clientes/constants"
import {
  deleteClientDocument,
  getClientDocumentDownloadUrl,
  registerClientDocument,
  requestClientDocumentUpload,
} from "@/lib/clientes/document-actions"
import {
  formatFileSize,
  getDocumentKindLabel,
  isAllowedDocumentMimeType,
  type ClientDocumentMimeType,
} from "@/lib/clientes/documents"
import { getImagePreparationMessage, prepareImage } from "@/lib/media/compress-image"
import { UPLOADS_BLOCKED_MESSAGE, isStorageForbiddenError } from "@/lib/media/upload-errors"
import { uploadWithTicket } from "@/lib/storage/signed-upload-client"

export type DocumentRowView = {
  id: string
  name: string
  mimeType: string | null
  sizeBytes: number | null
  uploadedByName: string
  createdAt: string
}

type DocumentsPanelProps = {
  clientId: string
  /** Não é mais usado: o caminho do arquivo é decidido no servidor. */
  organizationId?: string
  documents: DocumentRowView[]
  canUpload: boolean
  canDelete: boolean
  /** Assinatura em modo leitura: o Storage recusa novos arquivos. */
  uploadsBlocked?: boolean
}

/** PDFs e imagens; HEIC do iPhone é aceito e convertido para JPEG. */
const DOCUMENT_ACCEPT = [
  ...CLIENT_DOCUMENT_MIME_TYPES,
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
].join(",")

type PreparedDocument = {
  blob: Blob
  name: string
  mimeType: ClientDocumentMimeType
  /** "3,1 MB → 540 KB" quando a imagem foi otimizada. */
  sizeLabel: string | null
}

function describeStorageError(error: { message: string; statusCode?: string | number }) {
  if (isStorageForbiddenError(error)) {
    return UPLOADS_BLOCKED_MESSAGE
  }

  const message = error.message.toLowerCase()

  if (message.includes("size") || message.includes("too large") || message.includes("413")) {
    return "O arquivo passa do limite de tamanho do armazenamento."
  }

  if (message.includes("mime") || message.includes("type")) {
    return "Formato não aceito. Envie PDF, JPG, PNG, WebP ou HEIC."
  }

  return "Falha no envio. Verifique a conexão e tente de novo."
}

/**
 * PDF passa sem alteração (até 10 MB). Imagem (foto de RG, comprovante) vira
 * JPEG de até 2000 px com qualidade 0,85: continua legível, fica bem menor e
 * perde EXIF/GPS no reencode (LGPD).
 */
async function prepareDocument(
  file: File
): Promise<{ ok: true; document: PreparedDocument } | { ok: false; error: string }> {
  if (detectFileKind(file) === "pdf") {
    if (file.size === 0) return { ok: false, error: "O arquivo está vazio." }
    if (file.size > CLIENT_DOCUMENT_PDF_MAX_BYTES) {
      return {
        ok: false,
        error: `O PDF tem ${formatBytes(file.size)}; o limite é ${formatBytes(CLIENT_DOCUMENT_PDF_MAX_BYTES)}. Gere uma versão reduzida (por exemplo, "Reduzir tamanho do arquivo" ou digitalização em tons de cinza) e envie de novo.`,
      }
    }
    return {
      ok: true,
      document: { blob: file, name: file.name, mimeType: "application/pdf", sizeLabel: null },
    }
  }

  try {
    const { main } = await prepareImage(file, "clientDocumentImage")

    if (!isAllowedDocumentMimeType(main.type) || main.bytes > CLIENT_DOCUMENT_MAX_BYTES) {
      return {
        ok: false,
        error: "Não foi possível otimizar esta imagem. Salve-a em JPEG e tente de novo.",
      }
    }

    return {
      ok: true,
      document: {
        blob: main.blob,
        name: replaceExtension(file.name, main.extension),
        mimeType: main.type,
        sizeLabel: formatSizeChange(file.size, main.bytes),
      },
    }
  } catch (error) {
    return { ok: false, error: getImagePreparationMessage(error) }
  }
}

export function DocumentsPanel({
  clientId,
  documents,
  canUpload,
  canDelete,
  uploadsBlocked = false,
}: DocumentsPanelProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isUploading, startUpload] = React.useTransition()
  const [progress, setProgress] = React.useState<string | null>(null)
  const [isDownloading, startDownload] = React.useTransition()
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null)

  function uploadFiles(files: File[]) {
    startUpload(async () => {
      const optimized: string[] = []
      let uploaded = 0

      // Um arquivo por vez: a otimização usa bastante memória no celular.
      for (const file of files) {
        setProgress(`${file.name}: otimizando…`)
        const prepared = await prepareDocument(file)

        if (!prepared.ok) {
          toast.add({
            title: `"${file.name}" não foi enviado`,
            description: prepared.error,
            type: "error",
          })
          continue
        }

        const { blob, name, mimeType, sizeLabel } = prepared.document
        setProgress(`${name}: enviando…${sizeLabel ? ` (${sizeLabel})` : ""}`)

        // O servidor confere a permissão, escolhe o caminho e devolve o token de envio.
        const ticket = await requestClientDocumentUpload({
          clientId,
          name: name.slice(0, 200),
          mimeType,
          sizeBytes: blob.size,
        })

        if (!ticket.ok) {
          toast.add({
            title: `"${file.name}" não foi enviado`,
            description: ticket.error,
            type: "error",
          })
          // Modo leitura: os próximos arquivos seriam recusados do mesmo jeito.
          if (ticket.blocked) break
          continue
        }

        const path = ticket.data.path
        const { error: uploadError } = await uploadWithTicket(
          CLIENT_DOCUMENTS_BUCKET,
          ticket.data,
          blob,
          { contentType: mimeType }
        )

        if (uploadError) {
          toast.add({
            title: `"${file.name}" não foi enviado`,
            description: describeStorageError(uploadError),
            type: "error",
          })
          // Modo leitura: os próximos arquivos seriam recusados do mesmo jeito.
          if (isStorageForbiddenError(uploadError)) break
          continue
        }

        const result = await registerClientDocument({
          clientId,
          storagePath: path,
          name: name.slice(0, 200),
          mimeType,
          sizeBytes: blob.size,
        })

        if (!result.ok) {
          // A Server Action apaga o arquivo sem registro: não fica órfão no bucket.
          toast.add({
            title: `"${file.name}" não foi registrado`,
            description: result.error,
            type: "error",
          })
          continue
        }

        uploaded += 1
        if (sizeLabel) optimized.push(`${name}: ${sizeLabel}`)
      }

      setProgress(null)

      if (uploaded > 0) {
        toast.add({
          title: uploaded === 1 ? "Documento enviado." : `${uploaded} documentos enviados.`,
          description:
            optimized.length > 0 ? `Imagens otimizadas: ${optimized.join("; ")}` : undefined,
          type: "success",
        })
      }
    })
  }

  function download(documentId: string) {
    setDownloadingId(documentId)

    startDownload(async () => {
      const result = await getClientDocumentDownloadUrl(documentId)
      setDownloadingId(null)

      if (!result.ok) {
        toast.add({ title: result.error, type: "error" })
        return
      }

      // URL assinada com Content-Disposition de download: não sai da página.
      window.location.assign(result.data.url)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <LockIcon />
        <AlertTitle>Documentos privados</AlertTitle>
        <AlertDescription>
          Os arquivos ficam em armazenamento privado. Cada download usa um link temporário e fica
          registrado com o seu usuário (LGPD).
        </AlertDescription>
      </Alert>

      {canUpload && uploadsBlocked ? <UploadsBlockedNotice /> : null}

      {canUpload && !uploadsBlocked ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              PDF até 10 MB. Fotos (JPG, PNG, WebP ou HEIC) são otimizadas no navegador e perdem os
              dados de localização antes do envio.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={DOCUMENT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ""
                if (files.length > 0) uploadFiles(files)
              }}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={isUploading}>
              {isUploading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadIcon data-icon="inline-start" />
              )}
              {isUploading ? "Enviando…" : "Enviar documentos"}
            </Button>
          </div>
          {progress ? (
            <p className="truncate text-sm text-muted-foreground" aria-live="polite">
              {progress}
            </p>
          ) : null}
        </div>
      ) : null}

      {documents.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum documento</EmptyTitle>
            <EmptyDescription>
              RG, CPF, comprovantes de renda e de residência e o termo de consentimento ficam aqui.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Enviado por</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-end">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => (
                <TableRow key={document.id}>
                  <TableCell className="max-w-72">
                    <span className="block truncate font-medium" title={document.name}>
                      {document.name}
                    </span>
                  </TableCell>
                  <TableCell>{getDocumentKindLabel(document.mimeType)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatFileSize(document.sizeBytes)}
                  </TableCell>
                  <TableCell>{document.uploadedByName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTime(document.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
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
                        <span className="sr-only">Baixar {document.name}</span>
                      </Button>
                      {canDelete ? (
                        <ConfirmDeleteButton
                          action={() => deleteClientDocument(document.id, clientId)}
                          label={`Remover ${document.name}`}
                          title="Remover este documento?"
                          description="O arquivo é apagado do armazenamento. Esta ação não pode ser desfeita."
                          confirmLabel="Remover"
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
