"use client"

import * as React from "react"
import Script from "next/script"
import { CircleAlertIcon, MessageCircleIcon } from "lucide-react"

import { META_WHATSAPP_TERMS } from "@workspace/core/connections"
import { isMetaMessageOrigin, META_MESSAGE_ORIGINS } from "@workspace/core/whatsapp/embedded-signup"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { Field, FieldContent, FieldLabel } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import {
  acceptWhatsappTerms,
  finishWhatsappConnection,
} from "@/app/(app)/configuracoes/conexoes/actions"

// Tipagem mínima do SDK da Meta. Só o que usamos.
type FbLoginResponse = { authResponse?: { code?: string } | null }

type FbSdk = {
  init: (options: {
    appId: string
    autoLogAppEvents: boolean
    xfbml: boolean
    version: string
  }) => void
  login: (
    callback: (response: FbLoginResponse) => void,
    options: {
      config_id: string
      response_type: "code"
      override_default_response_type: boolean
      extras: { setup: Record<string, unknown> }
    }
  ) => void
}

declare global {
  interface Window {
    FB?: FbSdk
    fbAsyncInit?: () => void
  }
}

type SignupData = { wabaId: string; phoneNumberId: string; businessId: string | null }

const SDK_SRC = "https://connect.facebook.net/pt_BR/sdk.js"

/** Lê o resultado do cadastro. Só chame depois de conferir a origem (isMetaMessageOrigin). */
function readSignupMessage(event: MessageEvent): SignupData | "cancel" | "error" | null {
  let payload: unknown

  try {
    payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data
  } catch {
    return null
  }

  if (typeof payload !== "object" || payload === null) {
    return null
  }

  const message = payload as Record<string, unknown>

  if (message.type !== "WA_EMBEDDED_SIGNUP") {
    return null
  }

  if (message.event === "CANCEL") {
    return "cancel"
  }

  if (message.event === "ERROR") {
    return "error"
  }

  const data =
    typeof message.data === "object" && message.data !== null
      ? (message.data as Record<string, unknown>)
      : {}
  const wabaId = typeof data.waba_id === "string" ? data.waba_id : ""
  const phoneNumberId = typeof data.phone_number_id === "string" ? data.phone_number_id : ""

  if (!/^[0-9]{5,30}$/.test(wabaId) || !/^[0-9]{5,30}$/.test(phoneNumberId)) {
    return "error"
  }

  return {
    wabaId,
    phoneNumberId,
    businessId: typeof data.business_id === "string" ? data.business_id : null,
  }
}

export function WhatsappConnectDialog({
  appId,
  configId,
  graphVersion,
  label,
}: {
  appId: string
  configId: string
  graphVersion: string
  label: string
}) {
  const [open, setOpen] = React.useState(false)
  const [accepted, setAccepted] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [sdkReady, setSdkReady] = React.useState(false)

  const signupRef = React.useRef<SignupData | null>(null)
  const codeRef = React.useRef<string | null>(null)
  const acceptanceRef = React.useRef<string | null>(null)
  const finishedRef = React.useRef(false)

  const finish = React.useCallback(() => {
    const signup = signupRef.current
    const code = codeRef.current
    const acceptanceId = acceptanceRef.current

    if (!signup || !code || !acceptanceId || finishedRef.current) {
      return
    }

    finishedRef.current = true

    startTransition(async () => {
      const result = await finishWhatsappConnection({
        code,
        wabaId: signup.wabaId,
        phoneNumberId: signup.phoneNumberId,
        businessId: signup.businessId,
        termsAcceptanceId: acceptanceId,
      })

      if (result.ok) {
        setOpen(false)
        toast.add({ title: "WhatsApp conectado", description: result.message, type: "success" })
        return
      }

      finishedRef.current = false
      setError(result.error)
    })
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }

    function onMessage(event: MessageEvent) {
      // A Meta manda o resultado por postMessage. Origem que não seja
      // https://facebook.com (ou subdomínio) é ignorada sem olhar o conteúdo.
      if (!META_MESSAGE_ORIGINS.includes(event.origin) && !isMetaMessageOrigin(event.origin)) {
        return
      }

      const parsed = readSignupMessage(event)

      if (parsed === null) {
        return
      }

      if (parsed === "cancel") {
        setError("A conexão foi cancelada na janela da Meta.")
        return
      }

      if (parsed === "error") {
        setError("A Meta não concluiu a conexão. Tente de novo.")
        return
      }

      signupRef.current = parsed
      finish()
    }

    window.addEventListener("message", onMessage)

    return () => {
      window.removeEventListener("message", onMessage)
    }
  }, [open, finish])

  function onScriptReady() {
    window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion })
    setSdkReady(true)
  }

  function onConnect() {
    setError(null)
    signupRef.current = null
    codeRef.current = null
    finishedRef.current = false

    startTransition(async () => {
      // O aceite é gravado ANTES de abrir a janela da Meta: é ele que prova o
      // que a pessoa leu, e a Meta não devolve isso por API.
      const acceptance = await acceptWhatsappTerms()

      if (!acceptance.ok) {
        setError(acceptance.error)
        return
      }

      acceptanceRef.current = acceptance.acceptanceId

      const fb = window.FB

      if (!fb) {
        setError("O componente da Meta não carregou. Recarregue a página e tente de novo.")
        return
      }

      fb.login(
        (response) => {
          // O `code` vive 30 segundos: ele vai para o servidor na hora.
          const code = response.authResponse?.code

          if (typeof code !== "string" || code.length < 8) {
            setError("A Meta não devolveu a autorização. Tente de novo.")
            return
          }

          codeRef.current = code
          finish()
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {} },
        }
      )
    })
  }

  return (
    <>
      <Script src={SDK_SRC} strategy="lazyOnload" onReady={onScriptReady} />
      <Dialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <DialogTrigger render={<Button />}>
          <MessageCircleIcon data-icon="inline-start" />
          {label}
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conectar o WhatsApp da imobiliária</DialogTitle>
            <DialogDescription>
              A conta no WhatsApp Business é da imobiliária. A Meta cobra o envio diretamente dela,
              no meio de pagamento cadastrado na conta da Meta — a plataforma cobra apenas o
              software.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="max-h-56 overflow-y-auto rounded-md border p-3 text-sm whitespace-pre-line text-muted-foreground">
              {META_WHATSAPP_TERMS.text}
            </div>

            <Field orientation="horizontal">
              <Checkbox
                id="aceite-termos-meta"
                checked={accepted}
                onCheckedChange={(next) => setAccepted(next === true)}
                disabled={isPending}
              />
              <FieldContent>
                <FieldLabel htmlFor="aceite-termos-meta">
                  Li e aceito os {META_WHATSAPP_TERMS.label} (versão {META_WHATSAPP_TERMS.version})
                </FieldLabel>
              </FieldContent>
            </Field>

            {error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível conectar</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isPending} />}>
              Cancelar
            </DialogClose>
            <Button onClick={onConnect} disabled={!accepted || isPending || !sdkReady}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Continuar na Meta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
