"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"

import {
  LISTING_PURPOSE_LABELS,
  LISTING_PURPOSE_VALUES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_VALUES,
  type PropertyType,
} from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@workspace/ui/components/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { TagsInput } from "@/components/clientes/tags-input"
import { maskMoneyInput } from "@/lib/clientes/format"
import { saveClientInterest } from "@/lib/clientes/interest-actions"
import {
  EMPTY_INTEREST_FORM_VALUES,
  interestFormSchema,
  type InterestFormValues,
} from "@/lib/clientes/interest-schema"

type TypeItem = { value: PropertyType; label: string }

const TYPE_ITEMS: TypeItem[] = PROPERTY_TYPE_VALUES.map((type) => ({
  value: type,
  label: PROPERTY_TYPE_LABELS[type],
}))

function PropertyTypesInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: string[]
  onChange: (types: string[]) => void
  invalid?: boolean
}) {
  const anchor = useComboboxAnchor()
  const selected = TYPE_ITEMS.filter((item) => value.includes(item.value))

  return (
    <Combobox
      multiple
      items={TYPE_ITEMS}
      value={selected}
      onValueChange={(items: TypeItem[]) => onChange(items.map((item) => item.value))}
      itemToStringLabel={(item: TypeItem) => item.label}
      isItemEqualToValue={(item: TypeItem, current: TypeItem) => item.value === current.value}
    >
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxValue>
          {(items: TypeItem[]) => (
            <>
              {items.map((item) => (
                <ComboboxChip key={item.value}>{item.label}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                id={id}
                placeholder={items.length > 0 ? "" : "Qualquer tipo"}
                aria-invalid={invalid || undefined}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>Nenhum tipo encontrado.</ComboboxEmpty>
        <ComboboxList>
          {(item: TypeItem) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

type InterestFormDialogProps = {
  clientId: string
  /** Perfil existente (edição). */
  interest?: { id: string; values: InterestFormValues }
  trigger: React.ReactElement
  children: React.ReactNode
}

export function InterestFormDialog({
  clientId,
  interest,
  trigger,
  children,
}: InterestFormDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const initialValues = interest?.values ?? EMPTY_INTEREST_FORM_VALUES

  const form = useForm<InterestFormValues>({
    resolver: zodResolver(interestFormSchema),
    mode: "onTouched",
    defaultValues: initialValues,
  })

  function onSubmit(values: InterestFormValues) {
    startTransition(async () => {
      const result = await saveClientInterest(clientId, interest?.id ?? null, values)

      if (!result.ok) {
        toast.add({ title: result.error, type: "error" })
        return
      }

      toast.add({
        title: result.message ?? "Perfil de busca salvo.",
        type: "success",
      })
      setOpen(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) form.reset(initialValues)
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {interest ? "Editar perfil de busca" : "Novo perfil de busca"}
            </DialogTitle>
            <DialogDescription>
              O que o cliente procura. Perfis ativos alimentam a lista de imóveis compatíveis.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Controller
              control={form.control}
              name="purpose"
              render={({ field }) => (
                <Field>
                  <FieldTitle id="interesse-finalidade-label">Finalidade</FieldTitle>
                  <ToggleGroup
                    aria-labelledby="interesse-finalidade-label"
                    variant="outline"
                    value={[field.value]}
                    onValueChange={(value: string[]) => {
                      const next = LISTING_PURPOSE_VALUES.find((purpose) => purpose === value[0])
                      if (next) field.onChange(next)
                    }}
                  >
                    {LISTING_PURPOSE_VALUES.map((purpose) => (
                      <ToggleGroupItem key={purpose} value={purpose}>
                        {LISTING_PURPOSE_LABELS[purpose]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="types"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="interesse-tipos">Tipos de imóvel</FieldLabel>
                  <PropertyTypesInput
                    id="interesse-tipos"
                    value={field.value}
                    onChange={field.onChange}
                    invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>Deixe vazio para aceitar qualquer tipo.</FieldDescription>
                  )}
                </Field>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="neighborhoods"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="interesse-bairros">Bairros</FieldLabel>
                    <TagsInput
                      id="interesse-bairros"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      invalid={fieldState.invalid}
                      placeholder="Ex.: Cambuí"
                      maxItems={30}
                      maxLength={120}
                      itemName="bairro"
                      listLabel="Bairros"
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>Vazio aceita qualquer bairro.</FieldDescription>
                    )}
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="city"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="interesse-cidade">Cidade</FieldLabel>
                    <Input
                      {...field}
                      id="interesse-cidade"
                      placeholder="Ex.: Campinas"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {(["minPrice", "maxPrice"] as const).map((name) => (
                <Controller
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`interesse-${name}`}>
                        {name === "minPrice" ? "Valor mínimo" : "Valor máximo"}
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>
                          <InputGroupText>R$</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          id={`interesse-${name}`}
                          ref={field.ref}
                          name={field.name}
                          value={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) => field.onChange(maskMoneyInput(event.target.value))}
                          inputMode="numeric"
                          placeholder={name === "minPrice" ? "Sem mínimo" : "Sem máximo"}
                          aria-invalid={fieldState.invalid}
                        />
                      </InputGroup>
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              ))}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {(["minBedrooms", "minParking"] as const).map((name) => (
                <Controller
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`interesse-${name}`}>
                        {name === "minBedrooms" ? "Quartos (mínimo)" : "Vagas (mínimo)"}
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`interesse-${name}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={50}
                        placeholder="Indiferente"
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              ))}
            </div>

            <Controller
              control={form.control}
              name="notes"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="interesse-notas">Observações</FieldLabel>
                  <Textarea
                    {...field}
                    id="interesse-notas"
                    rows={3}
                    placeholder="Ex.: precisa aceitar pet; andar alto."
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="active"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="interesse-ativo">Perfil ativo</FieldLabel>
                    <FieldDescription>
                      Perfis inativos não entram no match de imóveis.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="interesse-ativo"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                  />
                </Field>
              )}
            />
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              {interest ? "Salvar perfil" : "Criar perfil"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
