"use client"

import { InfoIcon } from "lucide-react"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import type { LandingMemberOption } from "@/lib/marketing/payload"

export function LeadsSection({
  members,
  value,
  onChange,
  error,
  disabled,
}: {
  members: LandingMemberOption[]
  value: string | null
  onChange: (value: string | null) => void
  error?: string | null
  disabled: boolean
}) {
  const known = value === null || members.some((member) => member.id === value)
  const items: { label: string; value: string | null }[] = [
    { label: "Sem responsável (fila do funil)", value: null },
    ...members.map((member) => ({
      label: `${member.name} · ${member.roleLabel}`,
      value: member.id,
    })),
    ...(known ? [] : [{ label: "Ex-membro da equipe", value }]),
  ]

  return (
    <FieldGroup>
      <Field data-invalid={Boolean(error) || !known} data-disabled={disabled || undefined}>
        <FieldLabel htmlFor="lp-responsavel">Corretor responsável</FieldLabel>
        <Select
          items={items}
          value={value}
          onValueChange={(next) => onChange(typeof next === "string" ? next : null)}
          disabled={disabled}
        >
          <SelectTrigger
            id="lp-responsavel"
            className="w-full"
            aria-invalid={Boolean(error) || !known || undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value ?? "sem-responsavel"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {error ? (
          <FieldError>{error}</FieldError>
        ) : !known ? (
          <FieldError>
            Esta pessoa não está mais ativa na equipe. Escolha outro responsável.
          </FieldError>
        ) : (
          <FieldDescription>
            Cada contato enviado por esta página vira um lead no funil, já atribuído a esta pessoa.
            Sem responsável, o lead entra na fila para distribuição.
          </FieldDescription>
        )}
      </Field>
      <Alert>
        <InfoIcon />
        <AlertDescription>
          Nos modelos com bloco do corretor, a página mostra o nome, a foto e o CRECI do responsável
          escolhido.
        </AlertDescription>
      </Alert>
    </FieldGroup>
  )
}
