"use client"

import { Button } from "@workspace/ui/components/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"

/**
 * Formulário de lead só para pré-visualização: mostra os campos da página
 * publicada, mas não envia nada.
 */
export function InertLeadForm({ idPrefix = "previa-lead" }: { idPrefix?: string }) {
  return (
    <form
      aria-label="Formulário de contato (pré-visualização)"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-nome`}>Nome</FieldLabel>
          <Input id={`${idPrefix}-nome`} autoComplete="off" placeholder="Seu nome" tabIndex={-1} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-telefone`}>WhatsApp</FieldLabel>
          <Input
            id={`${idPrefix}-telefone`}
            autoComplete="off"
            inputMode="tel"
            placeholder="(11) 90000-0000"
            tabIndex={-1}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-email`}>E-mail</FieldLabel>
          <Input
            id={`${idPrefix}-email`}
            autoComplete="off"
            type="email"
            placeholder="voce@email.com"
            tabIndex={-1}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-mensagem`}>Mensagem</FieldLabel>
          <Textarea
            id={`${idPrefix}-mensagem`}
            rows={3}
            placeholder="Gostaria de mais informações."
            tabIndex={-1}
          />
        </Field>
        <Field>
          <Button type="submit" disabled>
            Quero ser contatado
          </Button>
          <FieldDescription>
            Pré-visualização: o envio funciona só na página publicada.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
