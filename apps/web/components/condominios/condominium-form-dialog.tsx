"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm, type Control } from "react-hook-form"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
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
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { AmenitiesField } from "@/components/imoveis/amenities-field"
import { CepInput } from "@/components/imoveis/cep-input"
import { MoneyInput } from "@/components/imoveis/money-input"
import type { CepAddress } from "@/lib/br/cep"
import { saveCondominiumAction } from "@/lib/condominios/actions"
import {
  CONDOMINIUM_LIMITS,
  condominiumFormSchema,
  EMPTY_CONDOMINIUM_FORM_VALUES,
  toCondominiumFormValues,
  type CondominiumFormSource,
  type CondominiumFormValues,
} from "@/lib/condominios/schema"
import { getAmenityOptions } from "@/lib/imoveis/amenities"

const AMENITY_OPTIONS = getAmenityOptions("condominium")

const STATE_ITEMS: { label: string; value: string | null }[] = [
  { label: "Selecione", value: null },
  ...BRAZILIAN_STATES.map((state) => ({
    label: `${state.code} · ${state.name}`,
    value: state.code,
  })),
]

const countFormat = new Intl.NumberFormat("pt-BR")

type TextFieldName = "name" | "street" | "streetNumber" | "complement" | "neighborhood" | "city"

function TextField({
  control,
  name,
  id,
  label,
  placeholder,
  maxLength,
}: {
  control: Control<CondominiumFormValues>
  name: TextFieldName
  id: string
  label: string
  placeholder?: string
  maxLength: number
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...field}
            id={id}
            autoComplete="off"
            placeholder={placeholder}
            maxLength={maxLength}
            aria-invalid={fieldState.invalid}
          />
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  )
}

export type CondominiumFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Presente = edição. */
  condominium?: CondominiumFormSource | null
  /** Chamado depois de salvar, com o id criado ou editado. */
  onSaved?: (id: string) => void
}

/** Cadastro e edição de condomínio em Dialog (reutilizável em outras telas). */
export function CondominiumFormDialog({
  open,
  onOpenChange,
  condominium = null,
  onSaved,
}: CondominiumFormDialogProps) {
  const isEditing = condominium !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar condomínio" : "Novo condomínio"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Atualize endereço, infraestrutura e taxa média. As mudanças valem para todos os imóveis vinculados."
              : "Cadastre o condomínio uma vez e vincule-o a quantos imóveis precisar."}
          </DialogDescription>
        </DialogHeader>
        {/* O conteúdo do Dialog desmonta ao fechar: cada abertura parte dos dados atuais. */}
        <CondominiumForm
          key={condominium?.id ?? "novo"}
          condominium={condominium}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  )
}

function CondominiumForm({
  condominium,
  onOpenChange,
  onSaved,
}: {
  condominium: CondominiumFormSource | null
  onOpenChange: (open: boolean) => void
  onSaved?: (id: string) => void
}) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [cepLookupError, setCepLookupError] = React.useState<string | null>(null)
  const isEditing = condominium !== null

  const form = useForm<CondominiumFormValues>({
    resolver: zodResolver(condominiumFormSchema),
    mode: "onTouched",
    defaultValues: condominium
      ? toCondominiumFormValues(condominium)
      : EMPTY_CONDOMINIUM_FORM_VALUES,
  })

  function handleAddressFound(address: CepAddress) {
    const options = { shouldDirty: true, shouldValidate: true }

    if (address.street) {
      form.setValue("street", address.street.slice(0, CONDOMINIUM_LIMITS.street), options)
    }
    if (address.neighborhood) {
      form.setValue(
        "neighborhood",
        address.neighborhood.slice(0, CONDOMINIUM_LIMITS.neighborhood),
        options
      )
    }
    if (address.city) {
      form.setValue("city", address.city.slice(0, CONDOMINIUM_LIMITS.city), options)
    }
    if (address.state) {
      form.setValue("state", address.state, options)
    }

    form.setFocus(address.street ? "streetNumber" : "street")
  }

  function onSubmit(values: CondominiumFormValues) {
    setFormError(null)

    startSubmit(async () => {
      let result: Awaited<ReturnType<typeof saveCondominiumAction>>

      try {
        result = await saveCondominiumAction(values, condominium?.id)
      } catch {
        const message =
          "Não foi possível falar com o servidor. Verifique sua conexão e tente de novo."
        setFormError(message)
        toast.add({
          title: "Não foi possível salvar o condomínio",
          description: message,
          type: "error",
        })
        return
      }

      if (!result) return

      if (!result.ok) {
        for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
          if (message) {
            form.setError(field as keyof CondominiumFormValues, {
              type: "server",
              message,
            })
          }
        }
        setFormError(result.error)
        toast.add({
          title: "Não foi possível salvar o condomínio",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message, type: "success" })
      onOpenChange(false)
      onSaved?.(result.id)
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <TextField
          control={form.control}
          name="name"
          id="condominio-nome"
          label="Nome"
          placeholder="Ex.: Residencial Jardim das Flores"
          maxLength={CONDOMINIUM_LIMITS.name}
        />

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Endereço</FieldLegend>
          <FieldDescription>
            Informe o CEP para preencher rua, bairro, cidade e UF automaticamente.
          </FieldDescription>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                name="postalCode"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="condominio-cep">CEP</FieldLabel>
                    <CepInput
                      ref={field.ref}
                      id="condominio-cep"
                      name={field.name}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      onAddressFound={handleAddressFound}
                      onLookupError={setCepLookupError}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : cepLookupError ? (
                      <FieldError>{cepLookupError}</FieldError>
                    ) : null}
                  </Field>
                )}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
              <TextField
                control={form.control}
                name="street"
                id="condominio-rua"
                label="Rua"
                placeholder="Ex.: Avenida Brasil"
                maxLength={CONDOMINIUM_LIMITS.street}
              />
              <TextField
                control={form.control}
                name="streetNumber"
                id="condominio-numero"
                label="Número"
                placeholder="Ex.: 1500"
                maxLength={CONDOMINIUM_LIMITS.streetNumber}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="complement"
                id="condominio-complemento"
                label="Complemento"
                placeholder="Ex.: Portaria da rua lateral"
                maxLength={CONDOMINIUM_LIMITS.complement}
              />
              <TextField
                control={form.control}
                name="neighborhood"
                id="condominio-bairro"
                label="Bairro"
                maxLength={CONDOMINIUM_LIMITS.neighborhood}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
              <TextField
                control={form.control}
                name="city"
                id="condominio-cidade"
                label="Cidade"
                maxLength={CONDOMINIUM_LIMITS.city}
              />
              <Controller
                name="state"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="condominio-uf">UF</FieldLabel>
                    <Select
                      items={STATE_ITEMS}
                      value={field.value ? field.value : null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        ref={field.ref}
                        id="condominio-uf"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {BRAZILIAN_STATES.map((state) => (
                            <SelectItem key={state.code} value={state.code}>
                              {state.code} · {state.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </div>
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <Controller
          name="amenities"
          control={form.control}
          render={({ field, fieldState }) => (
            <>
              <AmenitiesField
                id="condominio-infraestrutura"
                legend="Infraestrutura"
                description="Marque o que o condomínio oferece. Use “Outras” para itens fora da lista."
                options={AMENITY_OPTIONS}
                value={field.value}
                onChange={field.onChange}
                disabled={isSubmitting}
              />
              {fieldState.invalid ? (
                <FieldError>
                  {fieldState.error?.message ?? "Confira os itens de infraestrutura."}
                </FieldError>
              ) : null}
            </>
          )}
        />

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Custos e observações</FieldLegend>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                name="avgCondoFee"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="condominio-taxa">Taxa média de condomínio</FieldLabel>
                    <MoneyInput
                      ref={field.ref}
                      id="condominio-taxa"
                      name={field.name}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      suffix="/mês"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>Valor mensal aproximado por unidade.</FieldDescription>
                    )}
                  </Field>
                )}
              />
            </div>
            <Controller
              name="notes"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="condominio-observacoes">Observações</FieldLabel>
                  <Textarea
                    {...field}
                    id="condominio-observacoes"
                    rows={4}
                    maxLength={CONDOMINIUM_LIMITS.notes}
                    placeholder="Ex.: regras para mudança, horário da portaria, administradora"
                    aria-invalid={fieldState.invalid}
                    aria-describedby="condominio-observacoes-contador"
                    className="max-h-64"
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  <FieldDescription
                    id="condominio-observacoes-contador"
                    className="text-end tabular-nums"
                  >
                    {countFormat.format(field.value.length)}/
                    {countFormat.format(CONDOMINIUM_LIMITS.notes)} caracteres
                  </FieldDescription>
                </Field>
              )}
            />
          </FieldGroup>
        </FieldSet>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {isEditing ? "Salvar alterações" : "Cadastrar condomínio"}
        </Button>
      </DialogFooter>
    </form>
  )
}
