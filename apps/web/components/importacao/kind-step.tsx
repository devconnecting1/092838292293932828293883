"use client"

import { Building2Icon, FunnelIcon, UsersIcon, type LucideIcon } from "lucide-react"

import { IMPORT_KIND_LABELS, IMPORT_KINDS, type ImportKind } from "@workspace/core/import/fields"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"

const KIND_DETAILS: Record<ImportKind, { icon: LucideIcon; description: string }> = {
  clients: {
    icon: UsersIcon,
    description:
      "Nome, telefone, WhatsApp, e-mail, CPF ou CNPJ, endereço, origem e etiquetas. Quem já está no CRM (mesmo telefone, e-mail ou CPF) não é duplicado.",
  },
  leads: {
    icon: FunnelIcon,
    description:
      "Contatos do funil com etapa, origem, interesse e as datas originais (entrada, 1º contato, ganho ou perda). A base antiga não entra no rodízio nem conta no prazo de primeiro contato.",
  },
  properties: {
    icon: Building2Icon,
    description:
      "Finalidade, tipo, preços, endereço, características, código de referência, proprietários e links das fotos (baixadas e otimizadas por nós). Sem preço ou área, entram como rascunho.",
  },
}

export function KindStep({
  value,
  onChange,
}: {
  value: ImportKind
  onChange: (kind: ImportKind) => void
}) {
  return (
    <FieldSet>
      <FieldLegend>O que você vai importar?</FieldLegend>
      <FieldDescription>
        Uma planilha por vez. Para trazer clientes e imóveis, importe um arquivo de cada.
      </FieldDescription>
      <RadioGroup value={value} onValueChange={(next) => onChange(next as ImportKind)}>
        {IMPORT_KINDS.map((kind) => {
          const Icon = KIND_DETAILS[kind].icon
          const id = `importacao-tipo-${kind}`

          return (
            <FieldLabel key={kind} htmlFor={id}>
              <Field orientation="horizontal">
                <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <FieldContent>
                  <FieldTitle>{IMPORT_KIND_LABELS[kind]}</FieldTitle>
                  <FieldDescription>{KIND_DETAILS[kind].description}</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={kind} id={id} />
              </Field>
            </FieldLabel>
          )
        })}
      </RadioGroup>
    </FieldSet>
  )
}
