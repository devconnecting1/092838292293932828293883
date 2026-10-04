"use client"

import { MessageCircleIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Controller, useFieldArray, useFormState, type Control } from "react-hook-form"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"

import type { LandingEditorFormValues } from "@/components/marketing/editor/types"
import { fillWhatsappMessage } from "@/lib/landing/format"
import type { LandingTemplateDefinition, LandingTemplateField } from "@/lib/landing/templates"
import { LANDING_CONTENT_LIMITS } from "@/lib/landing/types"
import {
  EMPTY_STAT,
  EMPTY_TESTIMONIAL,
  EMPTY_TYPOLOGY,
  countChars,
  maskPhone,
} from "@/lib/marketing/schemas"

type FormControl = Control<LandingEditorFormValues>

/** Variáveis da mensagem do WhatsApp: {codigo} e {pagina}. */
export type WhatsappVariables = { codigo: string | null; pagina: string }

const TEXT_NAMES = {
  headline: "content.headline",
  subheadline: "content.subheadline",
  cta_label: "content.cta_label",
  description: "content.description",
  whatsapp_number: "content.whatsapp_number",
  whatsapp_message: "content.whatsapp_message",
  countdown_until: "content.countdown_until",
  financing_note: "content.financing_note",
  units_left: "content.units_left",
  "launch.name": "content.launch.name",
  "launch.developer": "content.launch.developer",
  "launch.delivery_date": "content.launch.delivery_date",
  "launch.neighborhood": "content.launch.neighborhood",
  "launch.city": "content.launch.city",
  "launch.state": "content.launch.state",
} as const

type TextFieldKey = keyof typeof TEXT_NAMES

function isTextKey(key: string): key is TextFieldKey {
  return key in TEXT_NAMES
}

function fieldId(key: string) {
  return `lp-conteudo-${key.replace(/[._]/g, "-")}`
}

function Counter({ count, max }: { count: number; max?: number }) {
  if (!max) return null
  return (
    <InputGroupText className={cn("tabular-nums", count > max && "text-destructive")}>
      {count}/{max}
    </InputGroupText>
  )
}

function FieldLabelText({ field }: { field: LandingTemplateField }) {
  return (
    <>
      {field.label}
      {field.required ? <span className="text-muted-foreground">(obrigatório)</span> : null}
    </>
  )
}

/** Prévia da mensagem do WhatsApp com as variáveis substituídas. */
function WhatsappMessagePreview({
  value,
  variables,
}: {
  value: string
  variables: WhatsappVariables
}) {
  const usesCode = /\{codigo\}/i.test(value)

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm" aria-live="polite">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageCircleIcon aria-hidden="true" className="size-3.5" />
        Mensagem que o cliente envia
      </span>
      {value.trim() ? (
        <p className="whitespace-pre-line">{fillWhatsappMessage(value, variables)}</p>
      ) : (
        <p className="text-muted-foreground">
          Sem mensagem própria: a página usa uma mensagem padrão do modelo.
        </p>
      )}
      {usesCode && !variables.codigo ? (
        <p className="text-xs text-muted-foreground">
          Sem imóvel ativo em destaque, {"{codigo}"} fica vazio na mensagem.
        </p>
      ) : null}
    </div>
  )
}

function TextContentField({
  field,
  name,
  control,
  disabled,
  whatsappVariables,
}: {
  field: LandingTemplateField
  name: (typeof TEXT_NAMES)[TextFieldKey]
  control: FormControl
  disabled: boolean
  whatsappVariables: WhatsappVariables
}) {
  const id = fieldId(field.key)
  const isWhatsappMessage = field.key === "whatsapp_message"

  return (
    <Controller
      name={name}
      control={control}
      render={({ field: input, fieldState }) => {
        const value = input.value ?? ""
        const describedBy = field.help ? `${id}-ajuda` : undefined
        const common = {
          id,
          name: input.name,
          ref: input.ref,
          onBlur: input.onBlur,
          disabled,
          "aria-invalid": fieldState.invalid || undefined,
          "aria-describedby": describedBy,
          placeholder: field.placeholder,
        }

        const insertVariable = (variable: string) => {
          const separator = value && !/\s$/.test(value) ? " " : ""
          const next = `${value}${separator}${variable}`
          if (!field.maxLength || countChars(next) <= field.maxLength) input.onChange(next)
        }

        let control: React.ReactNode

        switch (field.kind) {
          case "textarea":
            control = (
              <InputGroup>
                <InputGroupTextarea
                  {...common}
                  rows={field.maxLength && field.maxLength > 300 ? 5 : 3}
                  maxLength={field.maxLength}
                  value={value}
                  onChange={(event) => input.onChange(event.target.value)}
                />
                <InputGroupAddon
                  align="block-end"
                  className={isWhatsappMessage ? "justify-between" : "justify-end"}
                >
                  {isWhatsappMessage ? (
                    <span className="flex gap-1">
                      <InputGroupButton
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => insertVariable("{codigo}")}
                      >
                        + {"{codigo}"}
                      </InputGroupButton>
                      <InputGroupButton
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => insertVariable("{pagina}")}
                      >
                        + {"{pagina}"}
                      </InputGroupButton>
                    </span>
                  ) : null}
                  <Counter count={countChars(value)} max={field.maxLength} />
                </InputGroupAddon>
              </InputGroup>
            )
            break
          case "phone":
            control = (
              <Input
                {...common}
                inputMode="tel"
                autoComplete="off"
                value={value}
                onChange={(event) => input.onChange(maskPhone(event.target.value))}
              />
            )
            break
          case "datetime":
            control = (
              <Input
                {...common}
                type="datetime-local"
                value={value}
                onChange={(event) => input.onChange(event.target.value)}
              />
            )
            break
          case "state":
            control = (
              <Input
                {...common}
                maxLength={2}
                autoComplete="off"
                className="w-20"
                value={value}
                onChange={(event) =>
                  input.onChange(
                    event.target.value
                      .replace(/[^a-zA-Z]/g, "")
                      .toUpperCase()
                      .slice(0, 2)
                  )
                }
              />
            )
            break
          case "number":
            control = (
              <Input
                {...common}
                inputMode="numeric"
                autoComplete="off"
                className="w-32"
                maxLength={String(field.max ?? LANDING_CONTENT_LIMITS.units_left.max).length}
                value={value}
                onChange={(event) => input.onChange(event.target.value.replace(/\D/g, ""))}
              />
            )
            break
          default:
            control = (
              <InputGroup>
                <InputGroupInput
                  {...common}
                  maxLength={field.maxLength}
                  autoComplete="off"
                  value={value}
                  onChange={(event) => input.onChange(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <Counter count={countChars(value)} max={field.maxLength} />
                </InputGroupAddon>
              </InputGroup>
            )
        }

        return (
          <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
            <FieldLabel htmlFor={id}>
              <FieldLabelText field={field} />
            </FieldLabel>
            {control}
            {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
            {field.kind === "datetime" && !fieldState.error ? (
              <FieldDescription id={describedBy}>
                {field.help ? `${field.help} ` : ""}Horário de Brasília.
              </FieldDescription>
            ) : field.help && !fieldState.error ? (
              <FieldDescription id={describedBy}>{field.help}</FieldDescription>
            ) : null}
            {isWhatsappMessage ? (
              <WhatsappMessagePreview value={value} variables={whatsappVariables} />
            ) : null}
          </Field>
        )
      }}
    />
  )
}

function ArrayRootError({ message }: { message?: string }) {
  return message ? <FieldError>{message}</FieldError> : null
}

function HighlightsField({
  field,
  control,
  disabled,
}: {
  field: LandingTemplateField
  control: FormControl
  disabled: boolean
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "content.highlights",
  })
  const { errors } = useFormState({ control, name: "content.highlights" })
  const max = field.maxItems ?? LANDING_CONTENT_LIMITS.highlights.items
  const maxLength = field.maxLength ?? LANDING_CONTENT_LIMITS.highlights.length
  const id = fieldId(field.key)

  return (
    <FieldSet data-disabled={disabled || undefined}>
      <FieldLegend variant="label">
        <FieldLabelText field={field} />
      </FieldLegend>
      {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
      {fields.length > 0 ? (
        <FieldGroup className="gap-2">
          {fields.map((item, index) => (
            <Controller
              key={item.id}
              name={`content.highlights.${index}.value`}
              control={control}
              render={({ field: input, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`${id}-${index}`} className="sr-only">
                    {field.label} {index + 1}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id={`${id}-${index}`}
                      ref={input.ref}
                      name={input.name}
                      value={input.value ?? ""}
                      maxLength={maxLength}
                      placeholder={index === 0 ? field.placeholder : undefined}
                      disabled={disabled}
                      aria-invalid={fieldState.invalid || undefined}
                      onBlur={input.onBlur}
                      onChange={(event) => input.onChange(event.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <Counter count={countChars(input.value ?? "")} max={maxLength} />
                      <InputGroupButton
                        size="icon-xs"
                        disabled={disabled}
                        onClick={() => remove(index)}
                      >
                        <Trash2Icon />
                        <span className="sr-only">
                          Remover item {index + 1} de {field.label.toLowerCase()}
                        </span>
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          ))}
        </FieldGroup>
      ) : null}
      <ArrayRootError message={errors.content?.highlights?.root?.message} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || fields.length >= max}
        onClick={() => append({ value: "" })}
      >
        <PlusIcon data-icon="inline-start" />
        Adicionar ({fields.length}/{max})
      </Button>
    </FieldSet>
  )
}

function StatsField({
  field,
  control,
  disabled,
}: {
  field: LandingTemplateField
  control: FormControl
  disabled: boolean
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "content.social_proof",
  })
  const { errors } = useFormState({ control, name: "content.social_proof" })
  const max = field.maxItems ?? LANDING_CONTENT_LIMITS.social_proof.items
  const labelMax = field.maxLength ?? LANDING_CONTENT_LIMITS.social_proof.label
  const valueMax = field.valueMaxLength ?? LANDING_CONTENT_LIMITS.social_proof.value
  const id = fieldId(field.key)

  return (
    <FieldSet data-disabled={disabled || undefined}>
      <FieldLegend variant="label">
        <FieldLabelText field={field} />
      </FieldLegend>
      {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
      {fields.map((item, index) => (
        <div key={item.id} className="flex items-start gap-2">
          <Controller
            name={`content.social_proof.${index}.value`}
            control={control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="w-28 shrink-0">
                <FieldLabel htmlFor={`${id}-${index}-valor`} className={cn(index > 0 && "sr-only")}>
                  Número
                </FieldLabel>
                <Input
                  id={`${id}-${index}-valor`}
                  ref={input.ref}
                  name={input.name}
                  value={input.value ?? ""}
                  maxLength={valueMax}
                  placeholder={index === 0 ? "+120" : undefined}
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={input.onBlur}
                  onChange={(event) => input.onChange(event.target.value)}
                />
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name={`content.social_proof.${index}.label`}
            control={control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="min-w-0 flex-1">
                <FieldLabel
                  htmlFor={`${id}-${index}-rotulo`}
                  className={cn(index > 0 && "sr-only")}
                >
                  O que significa
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={`${id}-${index}-rotulo`}
                    ref={input.ref}
                    name={input.name}
                    value={input.value ?? ""}
                    maxLength={labelMax}
                    placeholder={index === 0 ? "Imóveis vendidos na região" : undefined}
                    disabled={disabled}
                    aria-invalid={fieldState.invalid || undefined}
                    onBlur={input.onBlur}
                    onChange={(event) => input.onChange(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <Counter count={countChars(input.value ?? "")} max={labelMax} />
                    <InputGroupButton
                      size="icon-xs"
                      disabled={disabled}
                      onClick={() => remove(index)}
                    >
                      <Trash2Icon />
                      <span className="sr-only">Remover número {index + 1}</span>
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>
      ))}
      <ArrayRootError message={errors.content?.social_proof?.root?.message} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || fields.length >= max}
        onClick={() => append({ ...EMPTY_STAT })}
      >
        <PlusIcon data-icon="inline-start" />
        Adicionar número ({fields.length}/{max})
      </Button>
    </FieldSet>
  )
}

function TestimonialsField({
  field,
  control,
  disabled,
}: {
  field: LandingTemplateField
  control: FormControl
  disabled: boolean
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "content.testimonials",
  })
  const { errors } = useFormState({ control, name: "content.testimonials" })
  const max = field.maxItems ?? LANDING_CONTENT_LIMITS.testimonials.items
  const textMax = field.maxLength ?? LANDING_CONTENT_LIMITS.testimonials.text
  const nameMax = LANDING_CONTENT_LIMITS.testimonials.name
  const id = fieldId(field.key)

  return (
    <FieldSet data-disabled={disabled || undefined}>
      <FieldLegend variant="label">
        <FieldLabelText field={field} />
      </FieldLegend>
      {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
      {fields.map((item, index) => (
        <div key={item.id} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Depoimento {index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => remove(index)}
            >
              <Trash2Icon />
              <span className="sr-only">Remover depoimento {index + 1}</span>
            </Button>
          </div>
          <Controller
            name={`content.testimonials.${index}.name`}
            control={control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${id}-${index}-nome`}>Nome do cliente</FieldLabel>
                <Input
                  id={`${id}-${index}-nome`}
                  ref={input.ref}
                  name={input.name}
                  value={input.value ?? ""}
                  maxLength={nameMax}
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={input.onBlur}
                  onChange={(event) => input.onChange(event.target.value)}
                />
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name={`content.testimonials.${index}.text`}
            control={control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${id}-${index}-texto`}>Depoimento</FieldLabel>
                <InputGroup>
                  <InputGroupTextarea
                    id={`${id}-${index}-texto`}
                    ref={input.ref}
                    name={input.name}
                    rows={3}
                    value={input.value ?? ""}
                    maxLength={textMax}
                    disabled={disabled}
                    aria-invalid={fieldState.invalid || undefined}
                    onBlur={input.onBlur}
                    onChange={(event) => input.onChange(event.target.value)}
                  />
                  <InputGroupAddon align="block-end" className="justify-end">
                    <Counter count={countChars(input.value ?? "")} max={textMax} />
                  </InputGroupAddon>
                </InputGroup>
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>
      ))}
      <ArrayRootError message={errors.content?.testimonials?.root?.message} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || fields.length >= max}
        onClick={() => append({ ...EMPTY_TESTIMONIAL })}
      >
        <PlusIcon data-icon="inline-start" />
        Adicionar depoimento ({fields.length}/{max})
      </Button>
    </FieldSet>
  )
}

const TYPOLOGY_NUMBER_FIELDS = [
  { key: "areaMin", label: "Área mínima (m²)", inputMode: "decimal" },
  { key: "areaMax", label: "Área máxima (m²)", inputMode: "decimal" },
  { key: "bedrooms", label: "Quartos", inputMode: "numeric" },
  { key: "priceFrom", label: "A partir de (R$)", inputMode: "decimal" },
] as const

function TypologiesField({
  field,
  control,
  disabled,
}: {
  field: LandingTemplateField
  control: FormControl
  disabled: boolean
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "content.launch.typologies",
  })
  const { errors } = useFormState({
    control,
    name: "content.launch.typologies",
  })
  const max = field.maxItems ?? LANDING_CONTENT_LIMITS.launch.typologies.items
  const nameMax = field.maxLength ?? LANDING_CONTENT_LIMITS.launch.typologies.name
  const id = fieldId(field.key)

  return (
    <FieldSet data-disabled={disabled || undefined}>
      <FieldLegend variant="label">
        <FieldLabelText field={field} />
      </FieldLegend>
      {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
      {fields.map((item, index) => (
        <div key={item.id} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Tipologia {index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => remove(index)}
            >
              <Trash2Icon />
              <span className="sr-only">Remover tipologia {index + 1}</span>
            </Button>
          </div>
          <Controller
            name={`content.launch.typologies.${index}.name`}
            control={control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${id}-${index}-nome`}>Nome da planta</FieldLabel>
                <Input
                  id={`${id}-${index}-nome`}
                  ref={input.ref}
                  name={input.name}
                  value={input.value ?? ""}
                  maxLength={nameMax}
                  placeholder={index === 0 ? "2 quartos com varanda" : undefined}
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  onBlur={input.onBlur}
                  onChange={(event) => input.onChange(event.target.value)}
                />
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            {TYPOLOGY_NUMBER_FIELDS.map((numberField) => (
              <Controller
                key={numberField.key}
                name={`content.launch.typologies.${index}.${numberField.key}`}
                control={control}
                render={({ field: input, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${id}-${index}-${numberField.key}`}>
                      {numberField.label}
                    </FieldLabel>
                    <Input
                      id={`${id}-${index}-${numberField.key}`}
                      ref={input.ref}
                      name={input.name}
                      value={input.value ?? ""}
                      inputMode={numberField.inputMode}
                      maxLength={16}
                      disabled={disabled}
                      aria-invalid={fieldState.invalid || undefined}
                      onBlur={input.onBlur}
                      onChange={(event) =>
                        input.onChange(event.target.value.replace(/[^\d.,]/g, ""))
                      }
                    />
                    {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            ))}
          </div>
        </div>
      ))}
      <ArrayRootError message={errors.content?.launch?.typologies?.root?.message} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || fields.length >= max}
        onClick={() => append({ ...EMPTY_TYPOLOGY })}
      >
        <PlusIcon data-icon="inline-start" />
        Adicionar tipologia ({fields.length}/{max})
      </Button>
    </FieldSet>
  )
}

function ContentField({
  field,
  control,
  disabled,
  whatsappVariables,
}: {
  field: LandingTemplateField
  control: FormControl
  disabled: boolean
  whatsappVariables: WhatsappVariables
}) {
  switch (field.kind) {
    case "list":
      return <HighlightsField field={field} control={control} disabled={disabled} />
    case "stats":
      return <StatsField field={field} control={control} disabled={disabled} />
    case "testimonials":
      return <TestimonialsField field={field} control={control} disabled={disabled} />
    case "typologies":
      return <TypologiesField field={field} control={control} disabled={disabled} />
    case "text":
    case "textarea":
    case "phone":
    case "datetime":
    case "state":
    case "number":
      return isTextKey(field.key) ? (
        <TextContentField
          field={field}
          name={TEXT_NAMES[field.key]}
          control={control}
          disabled={disabled}
          whatsappVariables={whatsappVariables}
        />
      ) : null
    default:
      return null
  }
}

/** Somente os campos que o modelo permite editar, na ordem do modelo. */
export function ContentSection({
  template,
  control,
  disabled,
  whatsappVariables,
}: {
  template: LandingTemplateDefinition
  control: FormControl
  disabled: boolean
  whatsappVariables: WhatsappVariables
}) {
  return (
    <FieldGroup>
      <FieldDescription>
        Campos vazios usam o texto padrão do modelo. A estrutura da página não muda: só os textos.
      </FieldDescription>
      {template.fields.map((field, index) => (
        <div key={field.key} className="flex flex-col gap-5">
          {index > 0 &&
          (field.kind === "typologies" ||
            field.kind === "testimonials" ||
            field.kind === "stats") ? (
            <Separator />
          ) : null}
          <ContentField
            field={field}
            control={control}
            disabled={disabled}
            whatsappVariables={whatsappVariables}
          />
        </div>
      ))}
    </FieldGroup>
  )
}
