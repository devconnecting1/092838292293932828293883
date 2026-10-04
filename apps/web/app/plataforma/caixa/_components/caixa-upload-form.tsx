"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, UploadIcon } from "lucide-react"

import { CAIXA_MAX_FILE_BYTES } from "@workspace/core/caixa/catalog-import"
import type { CaixaRejectionReason } from "@workspace/core/caixa/csv"
import { formatBrDate } from "@workspace/core/caixa/normalize"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

import {
  CAIXA_REJECTION_LABELS,
  CAIXA_UPLOAD_API_PATH,
  CAIXA_UPLOAD_MAX_BODY_BYTES,
  type CaixaUploadResponse,
} from "@/lib/plataforma/caixa-labels"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"

const numberFormat = new Intl.NumberFormat("pt-BR")

type Feedback = CaixaUploadResponse | { ok: false; reason: "cliente"; message: string }

/**
 * Compacta o CSV no navegador (gzip) antes de subir: a Vercel recusa corpo
 * acima de 4,5 MB e o arquivo da Caixa tem de 3 a 4 MB (compactado, cai para
 * uma fração). Navegador sem CompressionStream manda o arquivo como está.
 */
async function packFile(file: File): Promise<{ body: Blob; contentType: string }> {
  if (typeof CompressionStream === "function") {
    const stream = file.stream().pipeThrough(new CompressionStream("gzip"))
    return { body: await new Response(stream).blob(), contentType: "application/gzip" }
  }

  return { body: file, contentType: "text/csv" }
}

async function readResponse(response: Response): Promise<Feedback> {
  if (response.status === 404) {
    return {
      ok: false,
      reason: "cliente",
      message: "Sua sessão não tem acesso a esta área. Entre de novo com o e-mail da equipe.",
    }
  }

  if (response.status === 413) {
    return {
      ok: false,
      reason: "cliente",
      message: "O arquivo é grande demais para enviar. Confira se é a lista da Caixa.",
    }
  }

  try {
    const data = (await response.json()) as CaixaUploadResponse

    if (typeof data === "object" && data !== null && typeof data.ok === "boolean") {
      return data
    }
  } catch {
    // Resposta que não é JSON (sessão expirada redireciona para o login, por exemplo).
  }

  return {
    ok: false,
    reason: "cliente",
    message: "Não foi possível enviar agora. Recarregue a página e tente de novo.",
  }
}

function rejectionSummary(byReason: Partial<Record<CaixaRejectionReason, number>> | undefined) {
  const entries = Object.entries(byReason ?? {}) as [CaixaRejectionReason, number][]

  return entries
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${numberFormat.format(count)} com ${CAIXA_REJECTION_LABELS[reason]}`)
    .join(", ")
}

/** readOnly = Somente leitura: campo e botão desabilitados (a rota recusa de qualquer jeito). */
export function CaixaUploadForm({ readOnly = false }: { readOnly?: boolean }) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (pending || readOnly) {
      return
    }

    const file = inputRef.current?.files?.[0]
    setFeedback(null)

    if (!file) {
      setFieldError("Escolha o arquivo .csv baixado do site da Caixa.")
      return
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFieldError("O arquivo precisa ser o .csv baixado do site da Caixa.")
      return
    }

    if (file.size === 0) {
      setFieldError("O arquivo está vazio.")
      return
    }

    if (file.size > CAIXA_MAX_FILE_BYTES) {
      setFieldError("O arquivo passa de 20 MB. Confira se é a lista da Caixa.")
      return
    }

    setFieldError(null)
    setPending(true)

    try {
      const { body, contentType } = await packFile(file)

      if (body.size > CAIXA_UPLOAD_MAX_BODY_BYTES) {
        setFeedback({
          ok: false,
          reason: "cliente",
          message: "O arquivo é grande demais para enviar. Confira se é a lista da Caixa.",
        })
        return
      }

      const response = await fetch(CAIXA_UPLOAD_API_PATH, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
        credentials: "same-origin",
        cache: "no-store",
      })
      const result = await readResponse(response)

      setFeedback(result)

      if (result.ok) {
        if (inputRef.current) {
          inputRef.current.value = ""
        }

        router.refresh()
      }
    } catch {
      setFeedback({
        ok: false,
        reason: "cliente",
        message:
          "A conexão caiu durante o envio. Nada foi marcado como fora da lista; tente de novo.",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FieldGroup>
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel htmlFor="caixa-arquivo">Arquivo da lista (.csv)</FieldLabel>
          <Input
            ref={inputRef}
            id="caixa-arquivo"
            name="arquivo"
            type="file"
            accept=".csv,text/csv"
            disabled={pending || readOnly}
            aria-invalid={fieldError ? true : undefined}
            onChange={() => {
              setFieldError(null)
              setFeedback(null)
            }}
          />
          <FieldDescription>
            Até 20 MB. Enviar de novo o mesmo arquivo não duplica nada.
          </FieldDescription>
          {fieldError ? <FieldError>{fieldError}</FieldError> : null}
        </Field>
      </FieldGroup>

      <div>
        <Button
          type="submit"
          disabled={pending || readOnly}
          aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          className="w-full sm:w-auto"
        >
          {pending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          {pending ? "Enviando e gravando…" : "Enviar lista"}
        </Button>
      </div>

      <div aria-live="polite">{feedback ? <FeedbackAlert feedback={feedback} /> : null}</div>
    </form>
  )
}

function FeedbackAlert({ feedback }: { feedback: Feedback }) {
  if (!feedback.ok) {
    const rejections =
      "rejectedByReason" in feedback ? rejectionSummary(feedback.rejectedByReason) : ""

    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Não deu para carregar a lista</AlertTitle>
        <AlertDescription>
          <p>{feedback.message}</p>
          {rejections ? <p>Linhas recusadas: {rejections}.</p> : null}
        </AlertDescription>
      </Alert>
    )
  }

  if (feedback.result === "unchanged") {
    return (
      <Alert>
        <InfoIcon />
        <AlertTitle>Nada mudou</AlertTitle>
        <AlertDescription>
          Este arquivo é igual ao da última carga. O catálogo continua como estava.
        </AlertDescription>
      </Alert>
    )
  }

  const listDate = formatBrDate(feedback.generatedOn)
  const rejections = rejectionSummary(feedback.rejectedByReason)

  return (
    <Alert>
      <CircleCheckIcon />
      <AlertTitle>
        {listDate ? `Catálogo atualizado: Lista da Caixa de ${listDate}` : "Catálogo atualizado"}
      </AlertTitle>
      <AlertDescription>
        <p>
          {numberFormat.format(feedback.total)} imóveis ativos ·{" "}
          {numberFormat.format(feedback.inserted)} novos · {numberFormat.format(feedback.updated)}{" "}
          atualizados · {numberFormat.format(feedback.delisted)} saíram da lista ·{" "}
          {numberFormat.format(feedback.rejected)} recusados.
        </p>
        {rejections ? <p>Linhas recusadas no arquivo: {rejections}.</p> : null}
      </AlertDescription>
    </Alert>
  )
}
