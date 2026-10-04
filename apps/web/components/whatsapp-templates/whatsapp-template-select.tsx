"use client"

import * as React from "react"

import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { DEFAULT_WHATSAPP_TEMPLATE } from "@/components/whatsapp-templates/use-whatsapp-composer"
import type { WhatsappTemplate } from "@/lib/whatsapp-templates/constants"

type WhatsappTemplateSelectProps = {
  id: string
  templates: WhatsappTemplate[]
  value: string
  onValueChange: (value: string) => void
  isLoading: boolean
  failed: boolean
  /** Rótulo do texto pronto do sistema. */
  defaultLabel: string
}

/** Seletor "Modelo" do diálogo de WhatsApp: texto pronto + modelos da imobiliária. */
export function WhatsappTemplateSelect({
  id,
  templates,
  value,
  onValueChange,
  isLoading,
  failed,
  defaultLabel,
}: WhatsappTemplateSelectProps) {
  const items = React.useMemo(
    () => [
      { value: DEFAULT_WHATSAPP_TEMPLATE, label: defaultLabel },
      ...templates.map((template) => ({ value: template.id, label: template.title })),
    ],
    [templates, defaultLabel]
  )

  return (
    <Field>
      <FieldLabel htmlFor={id}>Modelo</FieldLabel>
      {isLoading && templates.length === 0 ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <Select
          items={items}
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") onValueChange(next)
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      <FieldDescription>
        {failed
          ? "Não foi possível carregar os modelos agora. Use o texto pronto ou escreva a mensagem."
          : templates.length === 0 && !isLoading
            ? "A gestão cria modelos com {nome}, {imovel}, {corretor} e {link} em Configurações."
            : "O modelo preenche a mensagem; dá para ajustar antes de abrir a conversa."}
      </FieldDescription>
    </Field>
  )
}
