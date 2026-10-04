"use client"

import * as React from "react"
import { CircleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { saveExportRoles } from "@/app/(app)/configuracoes/permissoes/actions"
import { ROLE_LABELS, type Role } from "@/lib/auth/roles"
import { CONFIGURABLE_EXPORT_ROLES } from "@/lib/configuracoes/export-permissions"

/** O que o arquivo traz para cada papel (o recorte é do banco, não desta tela). */
const EXPORT_SCOPE_BY_ROLE: Record<Role, string> = {
  owner: "Sempre exporta a base inteira, com CPF/CNPJ.",
  manager: "Base inteira da imobiliária, com CPF/CNPJ e escolha de corretor.",
  broker: "Só os leads, clientes, imóveis e propostas ligados a ele, sem CPF/CNPJ.",
  capturer: "Só os registros ligados a ele (imóveis que captou), sem CPF/CNPJ.",
  assistant: "Só os registros ligados a ele, sem CPF/CNPJ.",
  finance: "Só os registros ligados a ele, sem CPF/CNPJ.",
}

function sameRoles(a: readonly Role[], b: readonly Role[]) {
  return a.length === b.length && a.every((role) => b.includes(role))
}

export function ExportRolesForm({ exportRoles }: { exportRoles: readonly Role[] }) {
  const initial = React.useMemo(
    () => CONFIGURABLE_EXPORT_ROLES.filter((role) => exportRoles.includes(role)),
    [exportRoles]
  )
  const [saved, setSaved] = React.useState<Role[]>(initial)
  const [selected, setSelected] = React.useState<Role[]>(initial)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const dirty = !sameRoles(saved, selected)

  function toggle(role: Role, checked: boolean) {
    setSelected((current) =>
      CONFIGURABLE_EXPORT_ROLES.filter((item) => (item === role ? checked : current.includes(item)))
    )
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    startTransition(async () => {
      const result = await saveExportRoles({ roles: selected })

      if (result.ok) {
        setSaved(selected)
        toast.add({ title: result.message ?? "Permissão salva.", type: "success" })
        return
      }

      setFormError(result.error)
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <FieldSet>
          <FieldLegend variant="label">Papéis que podem exportar</FieldLegend>
          <FieldDescription>
            Vale para todos os arquivos CSV de Relatórios. Quem fica desmarcado não vê o botão e
            recebe recusa mesmo por link direto.
          </FieldDescription>

          <FieldGroup className="gap-4">
            <Field orientation="horizontal" data-disabled>
              <Checkbox id="exportar-owner" checked disabled />
              <FieldContent>
                <FieldLabel htmlFor="exportar-owner">{ROLE_LABELS.owner}</FieldLabel>
                <FieldDescription>{EXPORT_SCOPE_BY_ROLE.owner}</FieldDescription>
              </FieldContent>
            </Field>

            {CONFIGURABLE_EXPORT_ROLES.map((role) => {
              const id = `exportar-${role}`

              return (
                <Field key={role} orientation="horizontal" data-disabled={isPending || undefined}>
                  <Checkbox
                    id={id}
                    checked={selected.includes(role)}
                    disabled={isPending}
                    onCheckedChange={(checked) => toggle(role, checked === true)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={id}>{ROLE_LABELS[role]}</FieldLabel>
                    <FieldDescription>{EXPORT_SCOPE_BY_ROLE[role]}</FieldDescription>
                  </FieldContent>
                </Field>
              )
            })}
          </FieldGroup>
        </FieldSet>

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending || !dirty}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar quem exporta
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
