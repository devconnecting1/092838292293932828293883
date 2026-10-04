"use client"

import * as React from "react"
import Link from "next/link"
import { HousePlusIcon } from "lucide-react"
import { Controller, useWatch } from "react-hook-form"

import { formatPhoneBr } from "@workspace/core/br/documents"
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_USAGE_LABELS,
} from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import {
  fieldId,
  SelectField,
  TextField,
  type PropertyFormControl,
  type SelectOption,
} from "@/components/imoveis/property-form/fields"
import type { CaptureSummary, MemberOption } from "@/components/imoveis/property-form/types"
import type { Role } from "@/lib/auth/roles"
import { ROLE_LABELS } from "@/lib/auth/roles"
import {
  DESCRIPTION_IDEAL_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  LISTING_PURPOSES,
  PROPERTY_TYPES,
  PROPERTY_USAGES,
  TITLE_MAX_LENGTH,
} from "@/lib/imoveis/constants"
import { mustStayAssigned } from "@/lib/imoveis/permissions"
import type { CondominiumOption } from "@/lib/imoveis/queries"
import { EXTERNAL_CODE_MAX_LENGTH, REGISTRY_NUMBER_MAX_LENGTH } from "@/lib/imoveis/schema"

const USAGE_ITEMS: SelectOption[] = PROPERTY_USAGES.map((value) => ({
  label: PROPERTY_USAGE_LABELS[value],
  value,
}))
const TYPE_ITEMS: SelectOption[] = PROPERTY_TYPES.map((value) => ({
  label: PROPERTY_TYPE_LABELS[value],
  value,
}))

type CondominiumItem = { value: string; label: string; hint: string }

function safePhone(value: string) {
  try {
    return formatPhoneBr(value)
  } catch {
    return value
  }
}

function CondominiumField({
  control,
  condominiums,
}: {
  control: PropertyFormControl
  condominiums: readonly CondominiumOption[]
}) {
  const items = React.useMemo<CondominiumItem[]>(
    () =>
      condominiums.map((condominium) => ({
        value: condominium.id,
        label: condominium.name,
        hint: [condominium.neighborhood, condominium.city].filter(Boolean).join(" · "),
      })),
    [condominiums]
  )

  return (
    <Controller
      name="condominiumId"
      control={control}
      render={({ field, fieldState }) => {
        const selected = items.find((item) => item.value === field.value) ?? null

        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={fieldId("condominiumId")}>Condomínio</FieldLabel>
            <Combobox
              items={items}
              value={selected}
              onValueChange={(item: CondominiumItem | null) => field.onChange(item?.value ?? "")}
              isItemEqualToValue={(item: CondominiumItem, value: CondominiumItem) =>
                item.value === value.value
              }
            >
              <ComboboxInput
                id={fieldId("condominiumId")}
                className="w-full"
                placeholder={items.length ? "Buscar condomínio" : "Nenhum condomínio cadastrado"}
                showClear={Boolean(selected)}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
              />
              <ComboboxContent>
                <ComboboxEmpty>Nenhum condomínio encontrado.</ComboboxEmpty>
                <ComboboxList>
                  {(item: CondominiumItem) => (
                    <ComboboxItem key={item.value} value={item}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.hint ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {item.hint}
                          </span>
                        ) : null}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {fieldState.invalid ? (
              <FieldError errors={[fieldState.error]} />
            ) : (
              <FieldDescription>
                Opcional. Não encontrou? <Link href="/condominios">Cadastre em Condomínios</Link>.
              </FieldDescription>
            )}
          </Field>
        )
      }}
    />
  )
}

export function StepDados({
  control,
  members,
  condominiums,
  role,
  capture,
}: {
  control: PropertyFormControl
  members: readonly MemberOption[]
  condominiums: readonly CondominiumOption[]
  role: Role
  capture: CaptureSummary | null
}) {
  const title = useWatch({ control, name: "title" })
  const description = useWatch({ control, name: "description" })
  const descriptionLength = description.trim().length

  const memberItems: SelectOption[] = [
    { label: "Não definido", value: null },
    ...members.map((member) => ({
      label: `${member.name} · ${member.roleLabel}${member.active ? "" : " (inativo)"}`,
      value: member.id,
    })),
  ]

  return (
    <FieldGroup>
      {capture ? (
        <Alert>
          <HousePlusIcon />
          <AlertTitle>Cadastro a partir de uma captação</AlertTitle>
          <AlertDescription>
            <p>
              Proprietário informado: {capture.ownerName}
              {capture.ownerEmail ? ` · ${capture.ownerEmail}` : ""}
              {capture.ownerPhone ? ` · ${safePhone(capture.ownerPhone)}` : ""}.
            </p>
            <p>
              Ao salvar, a captação é marcada como convertida. Cadastre o proprietário em{" "}
              <Link href="/clientes/novo">Clientes</Link> e vincule-o na aba Proprietários da ficha
              do imóvel.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <TextField
        control={control}
        name="title"
        label="Título do anúncio"
        placeholder="Ex.: Apartamento de 3 quartos com varanda gourmet no Cambuí"
        maxLength={TITLE_MAX_LENGTH}
        description={`${title.trim().length}/${TITLE_MAX_LENGTH} caracteres. Os portais aceitam de 10 a 100.`}
      />

      <Controller
        name="description"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={fieldId("description")}>Descrição</FieldLabel>
            <Textarea
              id={fieldId("description")}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              rows={8}
              maxLength={DESCRIPTION_MAX_LENGTH}
              placeholder="Destaque ambientes, acabamentos, posição solar, lazer do condomínio e o que há por perto."
              aria-invalid={fieldState.invalid}
              aria-describedby={`${fieldId("description")}-contador`}
            />
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            <FieldDescription id={`${fieldId("description")}-contador`} aria-live="polite">
              {descriptionLength} caracteres.{" "}
              {descriptionLength >= DESCRIPTION_IDEAL_LENGTH
                ? "Tamanho ideal para a Nota do Anúncio."
                : `Faltam ${DESCRIPTION_IDEAL_LENGTH - descriptionLength} para o ideal (${DESCRIPTION_IDEAL_LENGTH}).`}{" "}
              Os portais aceitam de 50 a 3.000.
            </FieldDescription>
          </Field>
        )}
      />

      <Controller
        name="purpose"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldTitle id={`${fieldId("purpose")}-titulo`}>Finalidade</FieldTitle>
            <ToggleGroup
              aria-labelledby={`${fieldId("purpose")}-titulo`}
              variant="outline"
              className="flex-wrap"
              value={[field.value]}
              onValueChange={(value) => {
                const next = value[0]
                if (next) field.onChange(next)
              }}
            >
              {LISTING_PURPOSES.map((purpose) => (
                <ToggleGroupItem key={purpose} value={purpose}>
                  {LISTING_PURPOSE_LABELS[purpose]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SelectField control={control} name="type" label="Tipo de imóvel" items={TYPE_ITEMS} />
        <SelectField control={control} name="usage" label="Uso" items={USAGE_ITEMS} />
      </div>

      <CondominiumField control={control} condominiums={condominiums} />

      <TextField
        control={control}
        name="externalCode"
        label="Código no sistema anterior"
        placeholder="Ex.: AP-001"
        maxLength={EXTERNAL_CODE_MAX_LENGTH}
        autoComplete="off"
        description="Opcional. O código que o imóvel tinha no sistema ou na planilha de antes; a busca de imóveis também encontra por ele."
      />

      <TextField
        control={control}
        name="registryNumber"
        label="Número da matrícula"
        placeholder="Ex.: 123.456"
        maxLength={REGISTRY_NUMBER_MAX_LENGTH}
        autoComplete="off"
        description="Opcional. Matrícula do imóvel no cartório de registro de imóveis. Não sai nos portais nem na página pública."
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SelectField control={control} name="capturedBy" label="Captador" items={memberItems} />
        <SelectField
          control={control}
          name="brokerId"
          label="Corretor responsável"
          items={memberItems}
        />
      </div>
      {mustStayAssigned(role) ? (
        <FieldDescription>
          Como {ROLE_LABELS[role].toLowerCase()}, mantenha-se como captador ou corretor para
          continuar editando este imóvel.
        </FieldDescription>
      ) : null}
    </FieldGroup>
  )
}
