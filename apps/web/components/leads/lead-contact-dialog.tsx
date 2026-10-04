"use client"

import * as React from "react"
import { PhoneCallIcon } from "lucide-react"

import { leadFirstName } from "@workspace/core/leads/whatsapp-message"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Field, FieldDescription, FieldGroup, FieldTitle } from "@workspace/ui/components/field"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import {
  LEAD_CONTACT_CHANNEL_LABELS,
  LEAD_CONTACT_CHANNELS,
  type LeadContactInput,
} from "@/lib/leads/constants"
import type { LeadContactChannel } from "@/lib/leads/db-types"

type LeadContactDialogProps = {
  leadName: string
  /** Lead sem 1º contato: o botão ganha destaque. */
  highlight: boolean
  disabled?: boolean
  onRegister: (contact: LeadContactInput) => void
}

function isChannel(value: unknown): value is LeadContactChannel {
  return typeof value === "string" && (LEAD_CONTACT_CHANNELS as readonly string[]).includes(value)
}

/**
 * "Registrar contato" com o canal (ligação, WhatsApp, e-mail, presencial) e a
 * resposta: "Falei com o cliente" conta como contato (e como 1º contato na
 * primeira vez); "Não consegui falar" grava só a tentativa.
 */
export function LeadContactDialog({
  leadName,
  highlight,
  disabled = false,
  onRegister,
}: LeadContactDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [channel, setChannel] = React.useState<LeadContactChannel>("call")
  const labelId = React.useId()
  const firstName = leadFirstName(leadName)

  function register(reached: boolean) {
    onRegister({ channel, reached })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setChannel("call")
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant={highlight ? "default" : "outline"} disabled={disabled} />
        }
      >
        <PhoneCallIcon data-icon="inline-start" />
        Registrar contato
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          <DialogDescription>
            {firstName ? `Como foi o contato com ${firstName}?` : "Como foi o contato?"} Só conta
            como contato no prazo quando você conseguiu falar com o cliente.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldTitle id={labelId}>Canal</FieldTitle>
            <ToggleGroup
              aria-labelledby={labelId}
              variant="outline"
              spacing={2}
              className="flex-wrap"
              value={[channel]}
              onValueChange={(value) => {
                if (isChannel(value[0])) setChannel(value[0])
              }}
            >
              {LEAD_CONTACT_CHANNELS.map((item) => (
                <ToggleGroupItem key={item} value={item}>
                  {LEAD_CONTACT_CHANNEL_LABELS[item]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              “Não consegui falar” fica no histórico como tentativa e o lead continua sem contato.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => register(false)}>
            Não consegui falar
          </Button>
          <Button type="button" onClick={() => register(true)}>
            Falei com o cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
