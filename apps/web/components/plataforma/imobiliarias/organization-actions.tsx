"use client"

import * as React from "react"
import { BanIcon, CalendarPlusIcon, LockOpenIcon } from "lucide-react"

import {
  ACTION_REASON_MAX_LENGTH,
  checkActionReason,
  extendedTrialEnd,
  PLATFORM_ACCOUNT_ACTION_ERRORS,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_MAX_AHEAD_DAYS,
  trialExtensionBlocker,
  type TrialExtensionDays,
  type TrialExtensionInput,
} from "@workspace/core/platform/accounts"
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
  FieldTitle,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import {
  extendTrialAction,
  setOrganizationBlockAction,
} from "@/app/plataforma/imobiliarias/actions"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"
import { formatDate } from "@/lib/format"

type OrganizationActionsProps = {
  /** false = Somente leitura: botões desabilitados (o servidor recusa de qualquer jeito). */
  canAct: boolean
  organizationId: string
  organizationName: string
  blocked: boolean
  trial: TrialExtensionInput
}

/**
 * Ações da ficha: bloquear/desbloquear e prorrogar o teste grátis. Cada uma
 * abre um diálogo de confirmação com motivo obrigatório; a RPC grava o registro
 * do console. Nada é apagado. Para "Somente leitura", os botões ficam
 * desabilitados, explicados pelo aviso no topo da ficha.
 */
export function OrganizationActions({
  canAct,
  organizationId,
  organizationName,
  blocked,
  trial,
}: OrganizationActionsProps) {
  const showTrial = trial.status === "trialing"

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {showTrial ? (
        <ExtendTrialDialog
          readOnly={!canAct}
          organizationId={organizationId}
          organizationName={organizationName}
          trial={trial}
        />
      ) : null}
      <BlockDialog
        readOnly={!canAct}
        organizationId={organizationId}
        organizationName={organizationName}
        blocked={blocked}
      />
    </div>
  )
}

function ReasonField({
  id,
  value,
  error,
  disabled,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  error: string | null
  disabled: boolean
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>Motivo</FieldLabel>
      <Textarea
        id={id}
        rows={3}
        value={value}
        maxLength={ACTION_REASON_MAX_LENGTH}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>
          Fica no registro do console. Não escreva dados pessoais de clientes.
        </FieldDescription>
      )}
    </Field>
  )
}

function BlockDialog({
  readOnly,
  organizationId,
  organizationName,
  blocked,
}: {
  readOnly: boolean
  organizationId: string
  organizationName: string
  blocked: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={blocked ? "outline" : "destructive"}
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        {blocked ? <LockOpenIcon data-icon="inline-start" /> : <BanIcon data-icon="inline-start" />}
        {blocked ? "Desbloquear conta" : "Bloquear conta"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {/* Monta a cada abertura: o motivo começa vazio. */}
        <BlockForm
          organizationId={organizationId}
          organizationName={organizationName}
          blocked={blocked}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function BlockForm({
  organizationId,
  organizationName,
  blocked,
  onDone,
}: {
  organizationId: string
  organizationName: string
  blocked: boolean
  onDone: () => void
}) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checked = checkActionReason(reason)

    if (!checked.ok) {
      setError(checked.message)
      return
    }

    startTransition(async () => {
      const result = await setOrganizationBlockAction({
        organizationId,
        blocked: !blocked,
        reason: checked.reason,
      })

      if (!result.ok) {
        toast.add({
          title: blocked ? "Não foi possível desbloquear" : "Não foi possível bloquear",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Pronto.", type: "success" })
      onDone()
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {blocked ? `Desbloquear ${organizationName}?` : `Bloquear ${organizationName}?`}
        </DialogTitle>
        <DialogDescription>
          {blocked
            ? "O acesso volta a seguir a assinatura: se o teste ou o plano estiverem em dia, a equipe da imobiliária volta a editar, usar a IA e enviar mensagens."
            : "A imobiliária fica em somente leitura: ninguém cria nem edita nada, a IA para e as conexões (WhatsApp) não enviam. Os dados continuam guardados e a cobrança na Stripe não muda."}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <ReasonField
          id="organization-block-reason"
          value={reason}
          error={error}
          disabled={isPending}
          placeholder={
            blocked
              ? "Ex.: pendência resolvida com o dono."
              : "Ex.: uso em desacordo com os termos."
          }
          onChange={(value) => {
            setReason(value)
            setError(null)
          }}
        />
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" variant={blocked ? "default" : "destructive"} disabled={isPending}>
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {blocked ? "Desbloquear conta" : "Bloquear conta"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ExtendTrialDialog({
  readOnly,
  organizationId,
  organizationName,
  trial,
}: {
  readOnly: boolean
  organizationId: string
  organizationName: string
  trial: TrialExtensionInput
}) {
  const [open, setOpen] = React.useState(false)
  const controlledByStripe = trial.planKey !== "trial" || trial.hasSubscription

  if (controlledByStripe) {
    return (
      <p className="text-sm text-muted-foreground sm:max-w-xs">
        {PLATFORM_ACCOUNT_ACTION_ERRORS.teste_controlado_pela_stripe}
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        <CalendarPlusIcon data-icon="inline-start" />
        Prorrogar teste grátis
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <ExtendTrialForm
          organizationId={organizationId}
          organizationName={organizationName}
          trial={trial}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ExtendTrialForm({
  organizationId,
  organizationName,
  trial,
  onDone,
}: {
  organizationId: string
  organizationName: string
  trial: TrialExtensionInput
  onDone: () => void
}) {
  // Fixo na abertura (o diálogo monta de novo a cada vez).
  const [now] = React.useState(() => new Date())
  const allowedDays = TRIAL_EXTENSION_DAYS.filter(
    (days) => trialExtensionBlocker(trial, days, now) === null
  )
  const [days, setDays] = React.useState<TrialExtensionDays | null>(allowedDays[0] ?? null)
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checked = checkActionReason(reason)

    if (!checked.ok) {
      setError(checked.message)
      return
    }

    if (!days) {
      return
    }

    startTransition(async () => {
      const result = await extendTrialAction({ organizationId, days, reason: checked.reason })

      if (!result.ok) {
        toast.add({
          title: "Não foi possível prorrogar o teste",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Teste prorrogado.", type: "success" })
      onDone()
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Prorrogar o teste de {organizationName}?</DialogTitle>
        <DialogDescription>
          O teste grátis é do nosso banco (sem assinatura na Stripe): nada é cobrado nem mudado na
          Stripe. Hoje ele termina em {formatDate(trial.trialEndsAt)}.
        </DialogDescription>
      </DialogHeader>

      {allowedDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {`Não dá para prorrogar mais: o teste não pode terminar mais de ${TRIAL_EXTENSION_MAX_AHEAD_DAYS} dias à frente de hoje.`}
        </p>
      ) : (
        <FieldGroup>
          <Field>
            <FieldTitle id="trial-extension-days-label">Quantos dias a mais</FieldTitle>
            <ToggleGroup
              aria-labelledby="trial-extension-days-label"
              variant="outline"
              spacing={2}
              value={days ? [String(days)] : []}
              onValueChange={(value) => {
                const next = TRIAL_EXTENSION_DAYS.find((option) => String(option) === value[0])
                if (next && allowedDays.includes(next)) setDays(next)
              }}
              disabled={isPending}
            >
              {TRIAL_EXTENSION_DAYS.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={String(option)}
                  disabled={!allowedDays.includes(option)}
                >
                  +{option} dias
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {days ? (
              <FieldDescription>
                Novo fim do teste: {formatDate(extendedTrialEnd(trial.trialEndsAt, days, now))}.
              </FieldDescription>
            ) : null}
          </Field>

          <ReasonField
            id="trial-extension-reason"
            value={reason}
            error={error}
            disabled={isPending}
            placeholder="Ex.: dono pediu mais prazo para migrar os imóveis."
            onChange={(value) => {
              setReason(value)
              setError(null)
            }}
          />
        </FieldGroup>
      )}

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        {allowedDays.length > 0 ? (
          <Button type="submit" disabled={isPending || !days}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Prorrogar teste
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  )
}
