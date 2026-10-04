"use client"

import * as React from "react"
import { CircleAlertIcon, CrownIcon } from "lucide-react"

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
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

import type { LeaderOption } from "@/components/equipes/team-form-dialog"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { setTeamLeader } from "@/lib/equipes/actions"

const NO_LEADER = "__sem_lider__"

/**
 * Escolher (ou tirar) o líder. Candidatos: ativos desta equipe ou sem equipe —
 * quem está em outra equipe precisa ser incluído aqui antes.
 */
export function TeamLeaderDialog({
  teamId,
  teamName,
  currentLeaderId,
  options,
}: {
  teamId: string
  teamName: string
  currentLeaderId: string | null
  options: readonly LeaderOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState(currentLeaderId ?? NO_LEADER)
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const id = `equipe-${teamId}-lider`

  const items = [
    { value: NO_LEADER, label: "Sem líder" },
    ...options.map((option) => ({
      value: option.id,
      label: `${option.name} · ${ROLE_LABELS[option.role]}`,
    })),
  ]

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    startTransition(async () => {
      const result = await setTeamLeader({
        teamId,
        leaderId: value === NO_LEADER ? "" : value,
      })

      if (result.ok) {
        toast.add({ title: result.message ?? "Líder atualizado.", type: "success" })
        setOpen(false)
        return
      }

      setFormError(result.fieldErrors?.leaderId ?? result.error)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return
        if (nextOpen) {
          setFormError(null)
          setValue(currentLeaderId ?? NO_LEADER)
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <CrownIcon data-icon="inline-start" />
        {currentLeaderId ? "Trocar líder" : "Escolher líder"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Líder da {teamName}</DialogTitle>
          <DialogDescription>
            O líder passa a ver os números somados desta equipe nos relatórios. Não muda o papel
            dele na imobiliária.
          </DialogDescription>
        </DialogHeader>

        <form id={`${id}-form`} onSubmit={submit} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível salvar</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field>
              <FieldLabel htmlFor={id}>Líder</FieldLabel>
              <Select
                items={items}
                value={value}
                onValueChange={(next) => setValue(next ?? NO_LEADER)}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Aparecem pessoas ativas desta equipe ou sem equipe. Para escolher alguém de outra
                equipe, inclua a pessoa aqui primeiro.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Cancelar
          </DialogClose>
          <Button
            type="submit"
            form={`${id}-form`}
            disabled={isPending || value === (currentLeaderId ?? NO_LEADER)}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar líder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
