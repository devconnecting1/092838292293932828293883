import { INCIDENT_LIMITS, type IncidentKind } from "@workspace/core/status/incidents"
import { INCIDENT_IMPACTS } from "@workspace/core/status/levels"
import {
  INCIDENT_IMPACT_LABELS,
  STATUS_COMPONENTS,
  STATUS_LEVEL_LABELS,
  type IncidentImpact,
} from "@workspace/core/status/public"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"

import { impactLevelLabel } from "@/components/plataforma/status/status-format"

/**
 * Campos dos formulários de incidente e manutenção (novo, atualização e
 * edição). Só montados dentro dos diálogos (componentes de cliente); recebem
 * valor e callbacks do `Controller` do react-hook-form.
 */

type FieldErrorValue = { message?: string } | undefined

type BaseFieldProps = {
  id: string
  invalid: boolean
  error: FieldErrorValue
  onBlur: () => void
  disabled?: boolean
}

const IMPACT_ITEMS = INCIDENT_IMPACTS.map((impact) => ({
  value: impact,
  label: INCIDENT_IMPACT_LABELS[impact],
}))

export function IncidentImpactField({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  error,
  disabled = false,
  kind,
  lockedHint,
}: BaseFieldProps & {
  value: IncidentImpact
  onChange: (value: IncidentImpact) => void
  kind: IncidentKind
  /** Texto no lugar da dica quando o campo está travado. */
  lockedHint?: string
}) {
  const hint =
    kind === "maintenance"
      ? `Enquanto a manutenção estiver em andamento, as partes marcadas aparecem como “${STATUS_LEVEL_LABELS.under_maintenance}”. O impacto descreve o tamanho da parada.`
      : value === "none"
        ? "As partes marcadas continuam “Operacional”: serve para avisar sem mudar a situação."
        : `Enquanto estiver em aberto, as partes marcadas aparecem no mínimo como “${impactLevelLabel(value)}”.`

  return (
    <Field data-invalid={invalid} data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>Impacto</FieldLabel>
      <Select
        items={IMPACT_ITEMS}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next)
        }}
        onOpenChange={(isOpen) => {
          if (!isOpen) onBlur()
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {IMPACT_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
                <span className="text-muted-foreground">· {impactLevelLabel(item.value)}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {invalid ? (
        <FieldError errors={[error]} />
      ) : (
        <FieldDescription>{disabled && lockedHint ? lockedHint : hint}</FieldDescription>
      )}
    </Field>
  )
}

export function IncidentComponentsField({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  error,
  disabled = false,
  description,
}: BaseFieldProps & {
  value: readonly string[]
  onChange: (value: string[]) => void
  description: string
}) {
  const selected = new Set(value)

  function toggle(key: string, checked: boolean) {
    const next = new Set(selected)

    if (checked) {
      next.add(key)
    } else {
      next.delete(key)
    }

    // Mantém a ordem da página pública.
    onChange(STATUS_COMPONENTS.map((component) => component.key).filter((entry) => next.has(entry)))
  }

  return (
    <FieldSet
      data-invalid={invalid}
      onBlur={(event) => {
        // Só conta como "tocado" quando o foco sai do grupo inteiro.
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur()
      }}
    >
      <FieldLegend variant="label">Partes afetadas</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <FieldGroup data-slot="checkbox-group" className="gap-3">
        {STATUS_COMPONENTS.map((component) => {
          const checkboxId = `${id}-${component.key}`

          return (
            <Field
              key={component.key}
              orientation="horizontal"
              data-invalid={invalid}
              data-disabled={disabled || undefined}
            >
              <Checkbox
                id={checkboxId}
                checked={selected.has(component.key)}
                disabled={disabled}
                aria-invalid={invalid}
                onCheckedChange={(checked) => toggle(component.key, checked === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor={checkboxId}>{component.name}</FieldLabel>
                <FieldDescription>{component.description}</FieldDescription>
              </FieldContent>
            </Field>
          )
        })}
      </FieldGroup>
      {invalid ? <FieldError errors={[error]} /> : null}
    </FieldSet>
  )
}

export function IncidentTitleField({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  error,
  placeholder,
}: BaseFieldProps & {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>Título</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        maxLength={INCIDENT_LIMITS.titleMax}
        placeholder={placeholder}
        aria-invalid={invalid}
      />
      {invalid ? (
        <FieldError errors={[error]} />
      ) : (
        <FieldDescription>
          Curto e sem termo técnico: até {INCIDENT_LIMITS.titleMax} caracteres.
        </FieldDescription>
      )}
    </Field>
  )
}

export function IncidentMessageField({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  error,
  placeholder,
}: BaseFieldProps & {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>Mensagem</FieldLabel>
      <Textarea
        id={id}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        maxLength={INCIDENT_LIMITS.messageMax}
        placeholder={placeholder}
        aria-invalid={invalid}
      />
      {invalid ? (
        <FieldError errors={[error]} />
      ) : (
        <FieldDescription>
          {value.length} de {INCIDENT_LIMITS.messageMax} caracteres. Texto puro, aparece para os
          clientes.
        </FieldDescription>
      )}
    </Field>
  )
}

export function MaintenanceDateField({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
  error,
}: BaseFieldProps & {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
      />
      {invalid ? (
        <FieldError errors={[error]} />
      ) : (
        <FieldDescription>Horário de Brasília.</FieldDescription>
      )}
    </Field>
  )
}
