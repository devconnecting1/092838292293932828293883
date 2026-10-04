"use client"

import * as React from "react"
import { MessageCircleIcon } from "lucide-react"

import {
  buildLeadWhatsappMessage,
  LEAD_WHATSAPP_MESSAGE_MAX_LENGTH,
  leadFirstName,
  renderWhatsappTemplate,
  whatsappPropertyLabel,
} from "@workspace/core/leads/whatsapp-message"
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
import type { LeadContactInput } from "@/lib/leads/constants"
import { leadWhatsappHref } from "@/lib/leads/format"
import type { LeadItem } from "@/lib/leads/types"

type LeadWhatsappButtonProps = {
  lead: Pick<LeadItem, "id" | "name" | "phone" | "property">
  /** Nome de quem vai conversar (o usuário logado), para a apresentação. */
  senderName: string | null
  /** Quem pode editar o lead responde "Conseguiu falar?" na volta. */
  canRegisterContact: boolean
  /** Mesma ação do "Registrar contato", com o canal WhatsApp. */
  onContact: (contact: LeadContactInput) => void
  /** Tamanho do botão que abre o diálogo (padrão `sm`, o da ficha do lead). */
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
}

type Step = "compose" | "confirm"

/**
 * WhatsApp do lead: mensagem pronta ou modelo da imobiliária (editável) e link
 * wa.me com o texto. Abrir a conversa NÃO registra contato: na volta, o
 * diálogo pergunta "Conseguiu falar?" — Sim grava o contato (e o 1º contato);
 * Não grava a tentativa. O telefone só vai no link que o próprio usuário abre;
 * nada é registrado em log.
 */
export function LeadWhatsappButton({
  lead,
  senderName,
  canRegisterContact,
  onContact,
  size = "sm",
  className,
}: LeadWhatsappButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<Step>("compose")
  const composer = useWhatsappComposer(lead.property?.id)

  if (!leadWhatsappHref(lead.phone)) {
    return null
  }

  const firstName = leadFirstName(lead.name)

  function answer(reached: boolean) {
    onContact({ channel: "whatsapp", reached })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (next) {
          setStep("compose")
          composer.load()
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size={size} className={className} />}>
        <MessageCircleIcon data-icon="inline-start" />
        WhatsApp
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {step === "confirm" ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {firstName ? `Conseguiu falar com ${firstName}?` : "Conseguiu falar com o cliente?"}
              </DialogTitle>
              <DialogDescription>
                Responda quando voltar do WhatsApp. Só o “Sim” conta como contato no prazo; o “Não”
                fica no histórico como tentativa.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                Responder depois
              </DialogClose>
              <Button type="button" variant="outline" onClick={() => answer(false)}>
                Não, só tentei
              </Button>
              <Button type="button" onClick={() => answer(true)}>
                Sim, conversamos
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // Montado a cada abertura: a mensagem recomeça do texto pronto.
          <LeadWhatsappForm
            lead={lead}
            senderName={senderName}
            canRegisterContact={canRegisterContact}
            composer={composer}
            onOpenChat={() => {
              // Troca de etapa depois do clique: o link abre a conversa antes.
              window.setTimeout(() => {
                if (canRegisterContact) {
                  setStep("confirm")
                } else {
                  setOpen(false)
                }
              }, 0)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LeadWhatsappForm({
  lead,
  senderName,
  canRegisterContact,
  composer,
  onOpenChat,
}: Pick<LeadWhatsappButtonProps, "lead" | "senderName" | "canRegisterContact"> & {
  composer: ReturnType<typeof useWhatsappComposer>
  onOpenChat: () => void
}) {
  const messageId = React.useId()
  const templateId = React.useId()
  const [templateValue, setTemplateValue] = React.useState(DEFAULT_WHATSAPP_TEMPLATE)
  const defaultMessage = buildLeadWhatsappMessage({
    leadName: lead.name,
    senderName,
    property: lead.property,
  })
  const [message, setMessage] = React.useState(defaultMessage)
  const href = leadWhatsappHref(lead.phone, message)
  const firstName = leadFirstName(lead.name)
  const templates = composer.data?.templates ?? []

  function chooseTemplate(value: string) {
    setTemplateValue(value)

    const template = templates.find((item) => item.id === value)

    if (!template) {
      setMessage(defaultMessage)
      return
    }

    setMessage(
      renderWhatsappTemplate(template.body, {
        nome: firstName,
        imovel: whatsappPropertyLabel(composer.data?.property ?? lead.property),
        corretor: senderName ?? composer.data?.senderName,
        link: composer.data?.propertyLink,
      })
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Conversar no WhatsApp</DialogTitle>
        <DialogDescription>
          {firstName ? `Mensagem para ${firstName}. ` : "Mensagem pronta. "}
          {canRegisterContact
            ? "Na volta, você diz se conseguiu falar: só assim o contato conta."
            : "Revise o texto antes de abrir a conversa."}
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
          defaultLabel="Mensagem de primeiro contato"
        />
        <Field>
          <FieldLabel htmlFor={messageId}>Mensagem</FieldLabel>
          <Textarea
            id={messageId}
            rows={5}
            maxLength={LEAD_WHATSAPP_MESSAGE_MAX_LENGTH}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <FieldDescription>Dá para ajustar o texto aqui ou no próprio WhatsApp.</FieldDescription>
        </Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        {href ? (
          <Button
            render={<a href={href} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
            onClick={onOpenChat}
          >
            <MessageCircleIcon data-icon="inline-start" />
            Abrir no WhatsApp
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  )
}
