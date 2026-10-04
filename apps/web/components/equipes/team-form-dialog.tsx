"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { TEAM_NAME_MAX_LENGTH } from "@workspace/core/teams/rules"
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
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { toast } from "@workspace/ui/components/toast"

import { ROLE_LABELS, type Role } from "@/lib/auth/roles"
import { createTeam, renameTeam } from "@/lib/equipes/actions"
import { teamNameField } from "@/lib/equipes/schemas"

const NO_LEADER = "__sem_lider__"

export type LeaderOption = { id: string; name: string; role: Role }

/** Os dois modos no mesmo formulário; a action revalida com o schema completo. */
const dialogSchema = z.object({
  teamId: z.string(),
  name: teamNameField,
  leaderId: z.string(),
})

type FormValues = z.infer<typeof dialogSchema>

/**
 * Criar equipe (nome + líder opcional) ou renomear (só nome). No criar, o líder
 * só pode ser quem ainda não está em equipe: o banco coloca o líder na equipe.
 */
export function TeamFormDialog(
  props:
    | { mode: "create"; leaderOptions: readonly LeaderOption[]; triggerLabel?: string }
    | { mode: "rename"; teamId: string; currentName: string }
) {
  const isCreate = props.mode === "create"
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const idPrefix = isCreate ? "equipe-nova" : `equipe-${props.teamId}`

  const defaults: FormValues = {
    teamId: isCreate ? "" : props.teamId,
    name: isCreate ? "" : props.currentName,
    leaderId: "",
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(dialogSchema),
    mode: "onTouched",
    defaultValues: defaults,
  })

  const leaderItems = isCreate
    ? [
        { value: NO_LEADER, label: "Sem líder por enquanto" },
        ...props.leaderOptions.map((option) => ({
          value: option.id,
          label: `${option.name} · ${ROLE_LABELS[option.role]}`,
        })),
      ]
    : []

  function onSubmit(values: FormValues) {
    setFormError(null)

    startTransition(async () => {
      const result = isCreate
        ? await createTeam({ name: values.name, leaderId: values.leaderId })
        : await renameTeam({ teamId: values.teamId, name: values.name })

      if (result.ok) {
        toast.add({ title: result.message ?? "Equipe salva.", type: "success" })
        setOpen(false)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof FormValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return
        if (nextOpen) {
          setFormError(null)
          form.reset(defaults)
        }
        setOpen(nextOpen)
      }}
    >
      {isCreate ? (
        <DialogTrigger render={<Button />}>
          <PlusIcon data-icon="inline-start" />
          {props.triggerLabel ?? "Nova equipe"}
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          <PencilIcon data-icon="inline-start" />
          Renomear
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isCreate ? "Nova equipe" : "Renomear equipe"}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Dê um nome que a gestão reconheça no relatório (ex.: Zona Sul, Locação)."
              : "O nome muda em todos os relatórios e metas. Nada mais é alterado."}
          </DialogDescription>
        </DialogHeader>

        <form id={`${idPrefix}-form`} onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível salvar</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={Boolean(form.formState.errors.name)}>
              <FieldLabel htmlFor={`${idPrefix}-nome`}>Nome da equipe</FieldLabel>
              <Input
                id={`${idPrefix}-nome`}
                maxLength={TEAM_NAME_MAX_LENGTH + 20}
                autoComplete="off"
                placeholder="Ex.: Equipe Zona Sul"
                aria-invalid={Boolean(form.formState.errors.name)}
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <FieldError errors={[form.formState.errors.name]} />
              ) : (
                <FieldDescription>
                  Até {TEAM_NAME_MAX_LENGTH} caracteres. Não pode repetir o nome de outra equipe.
                </FieldDescription>
              )}
            </Field>

            {isCreate ? (
              <Controller
                control={form.control}
                name="leaderId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${idPrefix}-lider`}>Líder</FieldLabel>
                    <Select
                      items={leaderItems}
                      value={field.value || NO_LEADER}
                      onValueChange={(value) =>
                        field.onChange(value === NO_LEADER ? "" : (value ?? ""))
                      }
                      onOpenChange={(nextOpen) => {
                        if (!nextOpen) field.onBlur()
                      }}
                    >
                      <SelectTrigger id={`${idPrefix}-lider`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {leaderItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>
                        Aparecem só pessoas ativas que ainda não estão em equipe. O líder entra na
                        equipe automaticamente.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />
            ) : null}
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Cancelar
          </DialogClose>
          <Button type="submit" form={`${idPrefix}-form`} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {isCreate ? "Criar equipe" : "Salvar nome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
