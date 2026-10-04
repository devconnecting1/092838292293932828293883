"use client"

import { useWatch } from "react-hook-form"

import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"

import { MoneyField, type PropertyFormControl } from "@/components/imoveis/property-form/fields"

export function StepValores({ control }: { control: PropertyFormControl }) {
  const purpose = useWatch({ control, name: "purpose" })
  const hasSale = purpose === "sale" || purpose === "sale_rent"
  const hasRent = purpose === "rent" || purpose === "sale_rent"

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Preço</FieldLegend>
        <FieldDescription>
          Obrigatório para sair do rascunho. Os portais recebem o valor inteiro em reais, sem
          centavos.
        </FieldDescription>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {hasSale ? (
            <MoneyField control={control} name="salePrice" label="Preço de venda" />
          ) : null}
          {hasRent ? (
            <MoneyField control={control} name="rentPrice" label="Aluguel" suffix="/mês" />
          ) : null}
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Custos do imóvel</FieldLegend>
        <FieldDescription>
          Condomínio e IPTU aparecem no anúncio e contam pontos na Nota do Anúncio.
        </FieldDescription>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <MoneyField
            control={control}
            name="condoFee"
            label="Condomínio"
            suffix="/mês"
            description="Deixe em branco se não houver."
          />
          <MoneyField
            control={control}
            name="iptuYearly"
            label="IPTU"
            suffix="/ano"
            description="Valor anual total do carnê."
          />
        </div>
      </FieldSet>
    </FieldGroup>
  )
}
