"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, InfoIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
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

import { reassignLeadsInBulk } from "@/app/(app)/configuracoes/rodizio/actions"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"
import {
  BULK_REASSIGN_DEFAULTS,
  bulkReassignSchema,
  type BulkReassignValues,
} from "@/lib/leads/routing"

/** Valor do select que representa "devolver para a roleta" (não é um usuário). */
const ROULETTE_VALUE = "roleta"

type LeadRoutingBulkReassignDialogProps = {
  organizationMembers: MemberOption[]
  /** Leads em aberto por pessoa, vindos do painel do rodízio. */
  openLeadsByUser: Record<string, number>
  /** A roleta está ligada (muda o que acontece com quem fica sem destino). */
  rouletteEnabled: boolean
  trigger: React.ReactElement
  children: React.ReactNode
}

export function LeadRoutingBulkReassignDialog({
  organizationMembers,
  openLeadsByUser,
  rouletteEnabled,
  trigger,
  children,
}: LeadRoutingBulkReassignDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<BulkReassignValues>({
    resolver: zodResolver(bulkReassignSchema),
    mode: "onTouched",
    defaultValues: BULK_REASSIGN_DEFAULTS,
  })

  const fromUserId = useWatch({ control: form.control, name: "fromUserId" })
  const toUserId = useWatch({ control: form.control, name: "toUserId" })
  const includeClosed = useWatch({ control: form.control, name: "includeClosed" })

  const fromName = getMemberName(organizationMembers, fromUserId, "o corretor escolhido")
  const toName = toUserId ? getMemberName(organizationMembers, toUserId) : null
  const openLeads = fromUserId ? (openLeadsByUser[fromUserId] ?? 0) : 0

  function reset() {
    setConfirming(false)
    setFormError(null)
    form.reset(BULK_REASSIGN_DEFAULTS)
  }

  /** Só valida e mostra o resumo; quem executa é o botão de confirmação. */
  function onReview() {
    setFormError(null)
    setConfirming(true)
  }

  function onConfirm() {
    const values = form.getValues()
    setFormError(null)

    startTransition(async () => {
      const result = await reassignLeadsInBulk(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Leads reatribuídos.", type: "success" })
        setOpen(false)
        return
      }

      setConfirming(false)

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof BulkReassignValues, { type: "server", message })
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
        if (nextOpen) reset()
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Passar os leads de um corretor</DialogTitle>
          <DialogDescription>
            Use quando alguém sai da imobiliária, entra de férias longas ou muda de carteira.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <InfoIcon />
              <AlertTitle>
                {toName
                  ? `Transferir os leads de ${fromName} para ${toName}`
                  : `Devolver os leads de ${fromName} para a distribuição`}
              </AlertTitle>
              <AlertDescription>
                {includeClosed
                  ? "Entram todos os leads dessa pessoa, inclusive os já ganhos e perdidos."
                  : `Entram os leads em aberto dessa pessoa${
                      openLeads > 0
                        ? `: ${openLeads} ${openLeads === 1 ? "lead" : "leads"} agora.`
                        : "."
                    }`}
              </AlertDescription>
            </Alert>

            {!toName ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>
                  {rouletteEnabled
                    ? "Os leads voltam para a roleta"
                    : "Os leads ficam sem responsável"}
                </AlertTitle>
                <AlertDescription>
                  {rouletteEnabled
                    ? "Cada lead vai para o próximo corretor da fila. Quem não puder receber agora espera a próxima janela de plantão."
                    : "Com o rodízio desligado, os leads ficam sem dono e qualquer corretor pode assumi-los."}
                </AlertDescription>
              </Alert>
            ) : null}

            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível reatribuir</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button variant="outline" disabled={isPending} onClick={() => setConfirming(false)}>
                Voltar
              </Button>
              <Button disabled={isPending} onClick={onConfirm}>
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                Confirmar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onReview)} noValidate className="flex flex-col gap-4">
            <FieldGroup>
              {formError ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Não foi possível reatribuir</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <Controller
                control={form.control}
                name="fromUserId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="reatribuir-de">De quem são os leads</FieldLabel>
                    <Select
                      items={organizationMembers.map((option) => ({
                        value: option.id,
                        label: option.name,
                      }))}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        id="reatribuir-de"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue placeholder="Escolha o corretor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {organizationMembers.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name} · {ROLE_LABELS[option.role]}
                              {openLeadsByUser[option.id]
                                ? ` · ${openLeadsByUser[option.id]} em aberto`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>
                        Só aparecem pessoas ativas na equipe. Quem já saiu precisa ser reativado
                        para aparecer aqui.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="toUserId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="reatribuir-para">Para quem vão</FieldLabel>
                    <Select
                      items={[
                        { value: ROULETTE_VALUE, label: "Devolver para a roleta" },
                        ...organizationMembers.map((option) => ({
                          value: option.id,
                          label: option.name,
                        })),
                      ]}
                      value={field.value ?? ROULETTE_VALUE}
                      onValueChange={(value) =>
                        field.onChange(!value || value === ROULETTE_VALUE ? null : value)
                      }
                      onOpenChange={(isOpen) => {
                        if (!isOpen) field.onBlur()
                      }}
                    >
                      <SelectTrigger
                        id="reatribuir-para"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={ROULETTE_VALUE}>Devolver para a roleta</SelectItem>
                          {organizationMembers.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name} · {ROLE_LABELS[option.role]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>
                        Escolha um corretor para transferir tudo de uma vez, ou devolva para a
                        roleta distribuir de novo.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="includeClosed"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="reatribuir-fechados">
                        Incluir leads já ganhos e perdidos
                      </FieldLabel>
                      <FieldDescription>
                        Normalmente não é preciso: o histórico continua valendo mesmo com o antigo
                        responsável.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="reatribuir-fechados"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </Field>
                )}
              />
            </FieldGroup>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />} disabled={isPending}>
                Cancelar
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                Revisar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
