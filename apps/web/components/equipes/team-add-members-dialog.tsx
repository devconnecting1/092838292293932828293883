"use client"

import * as React from "react"
import { CircleAlertIcon, UserPlusIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { ROLE_LABELS, type Role } from "@/lib/auth/roles"
import { addTeamMembers } from "@/lib/equipes/actions"

export type AddMemberCandidate = {
  id: string
  name: string
  role: Role
  /** Nome da equipe atual (a pessoa sai de lá), ou null. */
  currentTeamName: string | null
  /** Nome da equipe que a pessoa lidera fora desta: não pode ser movida. */
  leadsTeamName: string | null
}

export function TeamAddMembersDialog({
  teamId,
  teamName,
  candidates,
}: {
  teamId: string
  teamName: string
  candidates: readonly AddMemberCandidate[]
}) {
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const prefix = `equipe-${teamId}-incluir`

  const movingCount = candidates.filter(
    (candidate) => selected.includes(candidate.id) && candidate.currentTeamName
  ).length

  function toggle(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)
    )
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    if (selected.length === 0) {
      setFormError("Marque pelo menos uma pessoa.")
      return
    }

    startTransition(async () => {
      const result = await addTeamMembers({ teamId, userIds: selected })

      if (result.ok) {
        toast.add({ title: result.message ?? "Equipe atualizada.", type: "success" })
        setOpen(false)
        return
      }

      setFormError(result.fieldErrors?.userIds ?? result.error)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return
        if (nextOpen) {
          setFormError(null)
          setSelected([])
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserPlusIcon data-icon="inline-start" />
        Incluir pessoas
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir na {teamName}</DialogTitle>
          <DialogDescription>
            Cada pessoa fica em uma equipe só. Quem já está em outra sai de lá ao entrar aqui.
          </DialogDescription>
        </DialogHeader>

        <form id={`${prefix}-form`} onSubmit={submit} noValidate className="min-h-0">
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível incluir</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todas as pessoas ativas da imobiliária já estão nesta equipe.
              </p>
            ) : (
              <FieldSet>
                <FieldLegend variant="label" className="sr-only">
                  Pessoas da imobiliária
                </FieldLegend>
                <FieldGroup className="max-h-[50dvh] gap-3 overflow-y-auto pe-1">
                  {candidates.map((candidate) => {
                    const id = `${prefix}-${candidate.id}`
                    const blocked = Boolean(candidate.leadsTeamName)

                    return (
                      <Field
                        key={candidate.id}
                        orientation="horizontal"
                        data-disabled={blocked || isPending || undefined}
                      >
                        <Checkbox
                          id={id}
                          checked={selected.includes(candidate.id)}
                          disabled={blocked || isPending}
                          onCheckedChange={(checked) => toggle(candidate.id, checked === true)}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={id}>{candidate.name}</FieldLabel>
                          <FieldDescription>
                            {ROLE_LABELS[candidate.role]} ·{" "}
                            {blocked
                              ? `líder da ${candidate.leadsTeamName}: troque o líder de lá antes`
                              : candidate.currentTeamName
                                ? `hoje na ${candidate.currentTeamName} (sai de lá)`
                                : "sem equipe"}
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    )
                  })}
                </FieldGroup>
              </FieldSet>
            )}

            {movingCount > 0 ? (
              <Alert>
                <CircleAlertIcon />
                <AlertTitle>
                  {movingCount === 1
                    ? "1 pessoa vai mudar de equipe"
                    : `${movingCount} pessoas vão mudar de equipe`}
                </AlertTitle>
                <AlertDescription>
                  Os relatórios somam cada pessoa na equipe de agora, inclusive nos meses
                  anteriores.
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Cancelar
          </DialogClose>
          <Button
            type="submit"
            form={`${prefix}-form`}
            disabled={isPending || selected.length === 0}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {selected.length > 1 ? `Incluir ${selected.length} pessoas` : "Incluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
