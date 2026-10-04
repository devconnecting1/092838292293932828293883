"use client"

import * as React from "react"
import { MessageCircleIcon } from "lucide-react"

import {
  LEAD_WHATSAPP_MESSAGE_MAX_LENGTH,
  renderWhatsappTemplate,
  whatsappPropertyLabel,
} from "@workspace/core/leads/whatsapp-message"
import { buildWhatsappShareUrl } from "@workspace/core/properties/share-text"
import { Button } from "@workspace/ui/components/button"
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Textarea } from "@workspace/ui/components/textarea"

import {
  DEFAULT_WHATSAPP_TEMPLATE,
  useWhatsappComposer,
} from "@/components/whatsapp-templates/use-whatsapp-composer"
import { WhatsappTemplateSelect } from "@/components/whatsapp-templates/whatsapp-template-select"

type PropertyWhatsappShareButtonProps = {
  propertyId: string
  /** Link wa.me com o texto pronto da ficha (sem endereço nem dados do proprietário). */
  whatsappHref: string
  /** Página pública do imóvel; null quando ela não está no ar. */
  publicUrl: string | null
}

/** Texto do link wa.me pronto (`?text=`), para começar o diálogo por ele. */
function readShareText(href: string) {
  try {
    return new URL(href).searchParams.get("text") ?? ""
  } catch {
    return ""
  }
}

function shareHref(text: string) {
  return buildWhatsappShareUrl(text.trim().slice(0, LEAD_WHATSAPP_MESSAGE_MAX_LENGTH))
}

/**
 * "Compartilhar no WhatsApp" da ficha do imóvel: texto pronto da ficha ou um
 * modelo da imobiliária ({imovel}, {corretor}, {link}; {nome} fica vazio, pois
 * não há cliente escolhido). Abre wa.me com o texto para o usuário escolher a
 * conversa — sem API da Meta.
 */
export function PropertyWhatsappShareButton({
  propertyId,
  whatsappHref,
  publicUrl,
}: PropertyWhatsappShareButtonProps) {
  const [open, setOpen] = React.useState(false)
  const composer = useWhatsappComposer(propertyId)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) composer.load()
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <MessageCircleIcon data-icon="inline-start" />
        Compartilhar no WhatsApp
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <PropertyWhatsappForm
          defaultText={readShareText(whatsappHref)}
          publicUrl={publicUrl}
          composer={composer}
          onShared={() => window.setTimeout(() => setOpen(false), 0)}
        />
      </DialogContent>
    </Dialog>
  )
}

function PropertyWhatsappForm({
  defaultText,
  publicUrl,
  composer,
  onShared,
}: {
  defaultText: string
  publicUrl: string | null
  composer: ReturnType<typeof useWhatsappComposer>
  onShared: () => void
}) {
  const templateId = React.useId()
  const messageId = React.useId()
  const [templateValue, setTemplateValue] = React.useState(DEFAULT_WHATSAPP_TEMPLATE)
  const [message, setMessage] = React.useState(defaultText)
  const templates = composer.data?.templates ?? []

  function chooseTemplate(value: string) {
    setTemplateValue(value)

    const template = templates.find((item) => item.id === value)

    setMessage(
      template
        ? renderWhatsappTemplate(template.body, {
            imovel: whatsappPropertyLabel(composer.data?.property),
            corretor: composer.data?.senderName,
            link: publicUrl ?? composer.data?.propertyLink,
          })
        : defaultText
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Compartilhar no WhatsApp</DialogTitle>
        <DialogDescription>
          Escolha o texto e, no WhatsApp, a conversa para onde enviar.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <WhatsappTemplateSelect
          id={templateId}
          templates={templates}
          value={templateValue}
          onValueChange={chooseTemplate}
          isLoading={composer.isLoading}
          failed={composer.failed}
          defaultLabel="Texto da ficha"
        />
        <Field>
          <FieldLabel htmlFor={messageId}>Mensagem</FieldLabel>
          <Textarea
            id={messageId}
            rows={6}
            maxLength={LEAD_WHATSAPP_MESSAGE_MAX_LENGTH}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <FieldDescription>
            {publicUrl
              ? "{link} vira o endereço da página pública do imóvel."
              : "A página pública deste imóvel não está no ar: {link} sai vazio."}
          </FieldDescription>
        </Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button
          render={<a href={shareHref(message)} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          onClick={onShared}
        >
          <MessageCircleIcon data-icon="inline-start" />
          Abrir no WhatsApp
          <span className="sr-only"> (abre em nova aba)</span>
        </Button>
      </DialogFooter>
    </div>
  )
}
