"use client"

import * as React from "react"
import { Controller, type UseFormSetValue } from "react-hook-form"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"
import { ADDRESS_DISPLAY_LABELS } from "@workspace/core/properties/enums"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"

import type { CepAddress } from "@/lib/br/cep"
import { CepInput } from "@/components/imoveis/cep-input"
import {
  fieldId,
  SelectField,
  TextField,
  type PropertyFormControl,
  type SelectOption,
} from "@/components/imoveis/property-form/fields"
import { ADDRESS_DISPLAY_HINTS, ADDRESS_DISPLAYS } from "@/lib/imoveis/constants"
import type { PropertyFormValues } from "@/lib/imoveis/schema"

const STATE_ITEMS: SelectOption[] = [
  { label: "Selecione", value: null },
  ...BRAZILIAN_STATES.map((state) => ({
    label: `${state.code} · ${state.name}`,
    value: state.code,
  })),
]

export function StepEndereco({
  control,
  setValue,
}: {
  control: PropertyFormControl
  setValue: UseFormSetValue<PropertyFormValues>
}) {
  const [lookupError, setLookupError] = React.useState<string | null>(null)
  const [lookupNotice, setLookupNotice] = React.useState<string | null>(null)

  function applyAddress(address: CepAddress) {
    const options = { shouldDirty: true, shouldValidate: true }
    if (address.street) setValue("street", address.street, options)
    if (address.neighborhood) setValue("neighborhood", address.neighborhood, options)
    if (address.city) setValue("city", address.city, options)
    if (address.state) setValue("state", address.state, options)
    setLookupNotice("Endereço preenchido pelo CEP. Confira e informe o número.")
  }

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Localização</FieldLegend>
        <FieldDescription>
          O endereço completo fica só no CRM; abaixo você escolhe o que aparece nos portais.
        </FieldDescription>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[14rem_1fr]">
          <Controller
            name="postalCode"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || Boolean(lookupError) || undefined}>
                <FieldLabel htmlFor={fieldId("postalCode")}>CEP</FieldLabel>
                <CepInput
                  id={fieldId("postalCode")}
                  name={field.name}
                  value={field.value}
                  onValueChange={(value) => {
                    setLookupNotice(null)
                    field.onChange(value)
                  }}
                  onBlur={field.onBlur}
                  onAddressFound={applyAddress}
                  onLookupError={(message) => {
                    setLookupError(message)
                    if (message) setLookupNotice(null)
                  }}
                  aria-invalid={fieldState.invalid || Boolean(lookupError)}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : lookupError ? (
                  <FieldError>{lookupError}</FieldError>
                ) : (
                  <FieldDescription aria-live="polite">
                    {lookupNotice ?? "Buscamos rua, bairro e cidade pelo CEP."}
                  </FieldDescription>
                )}
              </Field>
            )}
          />
          <TextField
            control={control}
            name="street"
            label="Rua"
            autoComplete="address-line1"
            maxLength={200}
          />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[10rem_1fr]">
          <TextField
            control={control}
            name="streetNumber"
            label="Número"
            maxLength={20}
            placeholder="Ex.: 120"
          />
          <TextField
            control={control}
            name="complement"
            label="Complemento"
            maxLength={120}
            placeholder="Ex.: Apto 82, bloco B"
          />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_1fr_12rem]">
          <TextField control={control} name="neighborhood" label="Bairro" maxLength={120} />
          <TextField
            control={control}
            name="city"
            label="Cidade"
            autoComplete="address-level2"
            maxLength={120}
          />
          <SelectField control={control} name="state" label="UF" items={STATE_ITEMS} />
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Coordenadas</FieldLegend>
        <FieldDescription>
          Opcionais, mas valem pontos na Nota do Anúncio. No Google Maps, clique com o botão direito
          sobre o imóvel e copie os números.
        </FieldDescription>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextField
            control={control}
            name="latitude"
            label="Latitude"
            inputMode="decimal"
            placeholder="-22.906847"
          />
          <TextField
            control={control}
            name="longitude"
            label="Longitude"
            inputMode="decimal"
            placeholder="-47.061573"
          />
        </div>
      </FieldSet>

      <FieldSeparator />

      <Controller
        name="addressDisplay"
        control={control}
        render={({ field }) => (
          <FieldSet>
            <FieldLegend>Exibição do endereço nos portais</FieldLegend>
            <FieldDescription>
              Controla o que o público vê no anúncio. Na dúvida, mostre só o bairro.
            </FieldDescription>
            <RadioGroup value={field.value} onValueChange={(value) => field.onChange(value)}>
              {ADDRESS_DISPLAYS.map((option) => (
                <FieldLabel key={option} htmlFor={`${fieldId("addressDisplay")}-${option}`}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{ADDRESS_DISPLAY_LABELS[option]}</FieldTitle>
                      <FieldDescription>{ADDRESS_DISPLAY_HINTS[option]}</FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value={option} id={`${fieldId("addressDisplay")}-${option}`} />
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </FieldSet>
        )}
      />
    </FieldGroup>
  )
}
