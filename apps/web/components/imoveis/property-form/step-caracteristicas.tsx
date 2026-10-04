"use client"

import { Controller, useWatch } from "react-hook-form"

import { PROPERTY_TYPE_LABELS, requiresLotArea } from "@workspace/core/properties/enums"
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"

import { AmenitiesField } from "@/components/imoveis/amenities-field"
import {
  CheckboxField,
  fieldId,
  TextField,
  type PropertyFormControl,
} from "@/components/imoveis/property-form/fields"
import { getAmenityOptions } from "@/lib/imoveis/amenities"

const PROPERTY_AMENITIES = getAmenityOptions("property")

export function StepCaracteristicas({ control }: { control: PropertyFormControl }) {
  const type = useWatch({ control, name: "type" })
  const lotRequired = requiresLotArea(type)

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Áreas</FieldLegend>
        <FieldDescription>
          {lotRequired
            ? `Para ${PROPERTY_TYPE_LABELS[type].toLowerCase()}, a área total do terreno é obrigatória para sair do rascunho.`
            : "A área útil é obrigatória para sair do rascunho."}
        </FieldDescription>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextField
            control={control}
            name="livingArea"
            label={lotRequired ? "Área construída (m²)" : "Área útil (m²) · obrigatória"}
            inputMode="decimal"
            placeholder="Ex.: 85,5"
          />
          <TextField
            control={control}
            name="lotArea"
            label={lotRequired ? "Área total (m²) · obrigatória" : "Área total (m²)"}
            inputMode="decimal"
            placeholder="Ex.: 300"
          />
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Cômodos</FieldLegend>
        <FieldDescription>
          Quartos e banheiros contam pontos na Nota do Anúncio (exceto terreno, galpão, fazenda e
          sítio).
        </FieldDescription>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <TextField
            control={control}
            name="bedrooms"
            label="Quartos"
            inputMode="numeric"
            placeholder="0"
          />
          <TextField
            control={control}
            name="suites"
            label="Suítes"
            inputMode="numeric"
            placeholder="0"
          />
          <TextField
            control={control}
            name="bathrooms"
            label="Banheiros"
            inputMode="numeric"
            placeholder="0"
          />
          <TextField
            control={control}
            name="parkingSpaces"
            label="Vagas"
            inputMode="numeric"
            placeholder="0"
          />
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Construção</FieldLegend>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
          <TextField
            control={control}
            name="floor"
            label="Andar"
            inputMode="numeric"
            placeholder="Ex.: 8"
            description="Térreo = 0."
          />
          <TextField
            control={control}
            name="totalFloors"
            label="Total de andares"
            inputMode="numeric"
          />
          <TextField
            control={control}
            name="yearBuilt"
            label="Ano de construção"
            inputMode="numeric"
            placeholder="Ex.: 2015"
          />
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Condições</FieldLegend>
        <FieldGroup className="gap-3">
          <CheckboxField control={control} name="furnished" label="Mobiliado" />
          <CheckboxField control={control} name="acceptsPets" label="Aceita animais de estimação" />
          <CheckboxField control={control} name="acceptsExchange" label="Aceita permuta" />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <Controller
        name="features"
        control={control}
        render={({ field }) => (
          <AmenitiesField
            id={fieldId("features")}
            legend="Comodidades"
            description="Marque o que o imóvel e o condomínio oferecem."
            options={PROPERTY_AMENITIES}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
    </FieldGroup>
  )
}
