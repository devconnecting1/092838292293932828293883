"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { FilePlusIcon, PencilIcon, PercentIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
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
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { timestampToDateInput } from "@/components/imoveis/detail/format"
import {
  authorizationFormSchema,
  formatPercentInput,
  type AuthorizationFormValues,
} from "@/components/imoveis/detail/schemas"
import type { AuthorizationItem } from "@/components/imoveis/detail/types"
import { saveAuthorizationAction } from "@/lib/imoveis/authorization-actions"

export type OwnerSelectOption = {
  value: string
  label: string
}

function getDefaults(
  ownerOptions: OwnerSelectOption[],
  today: string,
  authorization: AuthorizationItem | undefined
): AuthorizationFormValues {
  if (authorization) {
    return {
      ownerClientId: authorization.ownerClientId,
      exclusive: authorization.exclusive,
      startsOn: authorization.startsOn,
      endsOn: authorization.endsOn ?? "",
      commissionPercent: formatPercentInput(authorization.commissionPercent),
      signedOn: timestampToDateInput(authorization.signedAt),
    }
  }

  return {
    ownerClientId: ownerOptions.length === 1 ? (ownerOptions[0]?.value ?? "") : "",
    exclusive: false,
    startsOn: today,
    endsOn: "",
    commissionPercent: "",
    signedOn: "",
  }
}

/** Cria (sem `authorization`) ou edita uma autorização de venda/locação. */
export function AuthorizationDialog({
  propertyId,
  ownerOptions,
  today,
  authorization,
}: {
  propertyId: string
  ownerOptions: OwnerSelectOption[]
  today: string
  authorization?: AuthorizationItem
}) {
  const isEdit = Boolean(authorization)
  const idPrefix = authorization ? `autorizacao-${authorization.id}` : "autorizacao-nova"
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const form = useForm<AuthorizationFormValues>({
    resolver: zodResolver(authorizationFormSchema),
    defaultValues: getDefaults(ownerOptions, today, authorization),
  })

  // Na edição, o proprietário atual pode não estar mais na lista de proprietários.
  const options =
    authorization && !ownerOptions.some((option) => option.value === authorization.ownerClientId)
      ? [
          ...ownerOptions,
          {
            value: authorization.ownerClientId,
            label: authorization.ownerName ?? "Cliente sem acesso",
          },
        ]
      : ownerOptions
  const selectItems = [{ label: "Selecione o proprietário", value: null }, ...options]

  function handleOpenChange(next: boolean) {
    if (next) form.reset(getDefaults(ownerOptions, today, authorization))
    setOpen(next)
  }

  function onSubmit(values: AuthorizationFormValues) {
    startTransition(async () => {
      const result = await saveAuthorizationAction(propertyId, authorization?.id ?? null, values)

      if (result.ok) {
        setOpen(false)
        toast.add({
          title: result.message ?? "Autorização salva.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível salvar a autorização",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {isEdit ? (
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <PencilIcon />
          <span className="sr-only">Editar autorização</span>
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button size="sm" />}>
          <FilePlusIcon data-icon="inline-start" />
          Nova autorização
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar autorização" : "Nova autorização"}</DialogTitle>
            <DialogDescription>
              Período, exclusividade e comissão combinados com o proprietário.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              name="ownerClientId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`${idPrefix}-proprietario`}>Proprietário</FieldLabel>
                  <Select
                    items={selectItems}
                    value={field.value ? field.value : null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) field.onBlur()
                    }}
                    disabled={isPending}
                  >
                    <SelectTrigger
                      id={`${idPrefix}-proprietario`}
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />

            <Controller
              name="exclusive"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Switch
                    id={`${idPrefix}-exclusiva`}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                    disabled={isPending}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={`${idPrefix}-exclusiva`}>Exclusiva</FieldLabel>
                    <FieldDescription>
                      Somente esta imobiliária pode anunciar e negociar o imóvel.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              )}
            />

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Controller
                name="startsOn"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${idPrefix}-inicio`}>Início</FieldLabel>
                    <Input
                      {...field}
                      id={`${idPrefix}-inicio`}
                      type="date"
                      disabled={isPending}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="endsOn"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${idPrefix}-fim`}>Fim</FieldLabel>
                    <Input
                      {...field}
                      id={`${idPrefix}-fim`}
                      type="date"
                      disabled={isPending}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>Em branco: sem prazo final.</FieldDescription>
                    )}
                  </Field>
                )}
              />
              <Controller
                name="commissionPercent"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${idPrefix}-comissao`}>Comissão (opcional)</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        {...field}
                        id={`${idPrefix}-comissao`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="Ex.: 6"
                        disabled={isPending}
                        aria-invalid={fieldState.invalid}
                      />
                      <InputGroupAddon align="inline-end">
                        <PercentIcon />
                      </InputGroupAddon>
                    </InputGroup>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="signedOn"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${idPrefix}-assinatura`}>
                      Assinada em (opcional)
                    </FieldLabel>
                    <Input
                      {...field}
                      id={`${idPrefix}-assinatura`}
                      type="date"
                      max={today}
                      disabled={isPending}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </div>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              {isEdit ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
