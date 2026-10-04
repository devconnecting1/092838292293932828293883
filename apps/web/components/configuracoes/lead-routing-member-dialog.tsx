"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, InfoIcon, PlusIcon, TrashIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
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
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import {
  addLeadRoutingShift,
  removeLeadRoutingShift,
  saveLeadRoutingMember,
} from "@/app/(app)/configuracoes/rodizio/actions"
import { ROLE_LABELS } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"
import {
  formatShiftRange,
  LEAD_ROUTING_MAX_SHIFTS_PER_MEMBER,
  LEAD_ROUTING_MEMBER_DEFAULTS,
  LEAD_ROUTING_SHIFT_DEFAULTS,
  leadRoutingMemberSchema,
  leadRoutingShiftSchema,
  SHIFT_END_OPTIONS,
  SHIFT_START_OPTIONS,
  toDateTimeLocalInput,
  weekdayLabel,
  WEEKDAY_VALUES,
  type LeadRoutingMemberValues,
  type LeadRoutingQueueMember,
  type LeadRoutingShiftValues,
} from "@/lib/leads/routing"

const WEIGHT_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

function weightLabel(weight: number) {
  if (weight === 1) return "1 · parte igual à dos colegas"
  return `${weight} · recebe ${weight}x mais que o peso 1`
}

function toValues(member: LeadRoutingQueueMember | undefined): LeadRoutingMemberValues {
  if (!member) {
    return LEAD_ROUTING_MEMBER_DEFAULTS
  }

  return {
    id: member.id,
    userId: member.userId,
    active: member.active,
    weight: member.weight,
    dailyLimit: member.dailyLimit,
    awayFrom: toDateTimeLocalInput(member.awayFrom),
    awayUntil: toDateTimeLocalInput(member.awayUntil),
  }
}

/** Escala de plantão de um corretor já salvo na fila. */
function ShiftsSection({ member }: { member: LeadRoutingQueueMember }) {
  const [isPending, startTransition] = React.useTransition()
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  const form = useForm<LeadRoutingShiftValues>({
    resolver: zodResolver(leadRoutingShiftSchema),
    mode: "onTouched",
    defaultValues: LEAD_ROUTING_SHIFT_DEFAULTS,
  })

  const isFull = member.shifts.length >= LEAD_ROUTING_MAX_SHIFTS_PER_MEMBER

  function onAdd(values: LeadRoutingShiftValues) {
    startTransition(async () => {
      const result = await addLeadRoutingShift(member.id, values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Janela adicionada.", type: "success" })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof LeadRoutingShiftValues, { type: "server", message })
        }
      }

      toast.add({
        title: "Não foi possível adicionar a janela",
        description: result.error,
        type: "error",
      })
    })
  }

  function onRemove(shiftId: string) {
    setRemovingId(shiftId)

    startTransition(async () => {
      const result = await removeLeadRoutingShift(shiftId)
      setRemovingId(null)

      if (result.ok) {
        toast.add({ title: result.message ?? "Janela removida.", type: "success" })
        return
      }

      toast.add({
        title: "Não foi possível remover a janela",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <FieldSet>
      <FieldLegend>Escala de plantão</FieldLegend>
      <FieldDescription>
        Horários em que este corretor pode receber leads do rodízio. Sem nenhuma janela cadastrada,
        ele atende sempre.
      </FieldDescription>

      {member.shifts.length === 0 ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Sem escala: atende em qualquer horário</AlertTitle>
          <AlertDescription>
            Cadastre janelas só se este corretor atender em horários específicos.
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="flex flex-col gap-2">
          {member.shifts.map((shift) => (
            <li
              key={shift.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="secondary">{weekdayLabel(shift.weekday)}</Badge>
                <span className="text-sm">{formatShiftRange(shift)}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover ${weekdayLabel(shift.weekday)} ${formatShiftRange(shift)}`}
                disabled={isPending}
                onClick={() => onRemove(shift.id)}
              >
                {removingId === shift.id ? <Spinner /> : <TrashIcon />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {isFull ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Limite de janelas atingido</AlertTitle>
          <AlertDescription>
            Cada corretor pode ter no máximo {LEAD_ROUTING_MAX_SHIFTS_PER_MEMBER} janelas. Remova
            uma antes de cadastrar outra.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          id="rodizio-janela-form"
          onSubmit={form.handleSubmit(onAdd)}
          noValidate
          className="flex flex-col gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Controller
              control={form.control}
              name="weekday"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="janela-dia">Dia</FieldLabel>
                  <Select
                    items={WEEKDAY_VALUES.map((value) => ({
                      value: String(value),
                      label: weekdayLabel(value),
                    }))}
                    value={String(field.value)}
                    onValueChange={(value) => {
                      if (value) field.onChange(Number(value))
                    }}
                  >
                    <SelectTrigger
                      id="janela-dia"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {WEEKDAY_VALUES.map((value) => (
                          <SelectItem key={value} value={String(value)}>
                            {weekdayLabel(value)}
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
              control={form.control}
              name="startMinute"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="janela-inicio">Começa</FieldLabel>
                  <Select
                    items={SHIFT_START_OPTIONS.map((option) => ({
                      value: String(option.value),
                      label: option.label,
                    }))}
                    value={String(field.value)}
                    onValueChange={(value) => {
                      if (value) field.onChange(Number(value))
                    }}
                  >
                    <SelectTrigger
                      id="janela-inicio"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {SHIFT_START_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
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
              control={form.control}
              name="endMinute"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="janela-fim">Termina</FieldLabel>
                  <Select
                    items={SHIFT_END_OPTIONS.map((option) => ({
                      value: String(option.value),
                      label: option.label,
                    }))}
                    value={String(field.value)}
                    onValueChange={(value) => {
                      if (value) field.onChange(Number(value))
                    }}
                  >
                    <SelectTrigger
                      id="janela-fim"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {SHIFT_END_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
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
          </div>
          <Field orientation="horizontal" className="justify-end">
            <Button type="submit" variant="outline" size="sm" disabled={isPending}>
              {isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              Adicionar janela
            </Button>
          </Field>
        </form>
      )}
    </FieldSet>
  )
}

type LeadRoutingMemberDialogProps = {
  /** Membros ativos da imobiliária (nome e papel de cada `user_id`). */
  organizationMembers: MemberOption[]
  /** Corretor já na fila. Sem ele, o diálogo adiciona alguém novo. */
  member?: LeadRoutingQueueMember
  /** Quem já está na fila: não aparece de novo na lista de adicionar. */
  queuedUserIds: readonly string[]
  trigger: React.ReactElement
  children: React.ReactNode
}

export function LeadRoutingMemberDialog({
  organizationMembers,
  member,
  queuedUserIds,
  trigger,
  children,
}: LeadRoutingMemberDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const initialValues = toValues(member)
  const form = useForm<LeadRoutingMemberValues>({
    resolver: zodResolver(leadRoutingMemberSchema),
    mode: "onTouched",
    defaultValues: initialValues,
  })

  const available = organizationMembers.filter((option) => !queuedUserIds.includes(option.id))
  const currentName =
    organizationMembers.find((option) => option.id === member?.userId)?.name ?? "Corretor"

  function onSubmit(values: LeadRoutingMemberValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await saveLeadRoutingMember(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Fila atualizada.", type: "success" })
        setOpen(false)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof LeadRoutingMemberValues, { type: "server", message })
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
          form.reset(toValues(member))
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {member ? `Rodízio de ${currentName}` : "Adicionar corretor à fila"}
          </DialogTitle>
          <DialogDescription>
            {member
              ? "Peso, limite diário, férias e escala de plantão deste corretor."
              : "Escolha quem entra no rodízio e como os leads são distribuídos para essa pessoa."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="rodizio-corretor-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível salvar</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            {member ? (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{currentName}</FieldTitle>
                  <FieldDescription>
                    Para trocar a pessoa, remova esta da fila e adicione a outra.
                  </FieldDescription>
                </FieldContent>
                <Badge variant="secondary">
                  {member.role ? ROLE_LABELS[member.role] : "Fora da equipe"}
                </Badge>
              </Field>
            ) : (
              <Controller
                control={form.control}
                name="userId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="rodizio-corretor">Quem entra na fila</FieldLabel>
                    <Select
                      items={available.map((option) => ({
                        value: option.id,
                        label: `${option.name} · ${ROLE_LABELS[option.role]}`,
                      }))}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) field.onBlur()
                      }}
                      disabled={available.length === 0}
                    >
                      <SelectTrigger
                        id="rodizio-corretor"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue placeholder="Escolha um membro da equipe" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {available.map((option) => (
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
                        {available.length === 0
                          ? "Todo mundo da equipe já está na fila."
                          : "Só quem está ativo na equipe pode entrar no rodízio."}
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />
            )}

            <Controller
              control={form.control}
              name="active"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="rodizio-corretor-ativo">Recebendo leads</FieldLabel>
                    <FieldDescription>
                      Desligue para pausar sem tirar da fila (folga, treinamento, licença).
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="rodizio-corretor-ativo"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </Field>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="weight"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="rodizio-peso">Peso na fila</FieldLabel>
                    <Select
                      items={WEIGHT_VALUES.map((value) => ({
                        value: String(value),
                        label: weightLabel(value),
                      }))}
                      value={String(field.value)}
                      onValueChange={(value) => {
                        if (value) field.onChange(Number(value))
                      }}
                    >
                      <SelectTrigger
                        id="rodizio-peso"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {WEIGHT_VALUES.map((value) => (
                            <SelectItem key={value} value={String(value)}>
                              {weightLabel(value)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>
                        Use peso maior para quem deve receber mais leads que os colegas.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="dailyLimit"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="rodizio-limite">Limite de leads por dia</FieldLabel>
                    <Input
                      id="rodizio-limite"
                      name={field.name}
                      ref={field.ref}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={500}
                      step={1}
                      placeholder="Sem limite"
                      value={field.value === null ? "" : String(field.value)}
                      onBlur={field.onBlur}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value === "" ? null : event.target.valueAsNumber
                        )
                      }
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : (
                      <FieldDescription>
                        Em branco, o corretor recebe sem teto. Ao bater o limite, ele sai da fila
                        até o dia seguinte.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              />
            </div>

            <FieldSet>
              <FieldLegend>Férias ou ausência</FieldLegend>
              <FieldDescription>
                Nesse período o corretor não recebe leads novos. Deixe em branco se ele não estiver
                afastado.
              </FieldDescription>
              <div className="grid gap-5 sm:grid-cols-2">
                <Controller
                  control={form.control}
                  name="awayFrom"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="rodizio-ferias-inicio">Sai em</FieldLabel>
                      <Input
                        id="rodizio-ferias-inicio"
                        name={field.name}
                        ref={field.ref}
                        type="datetime-local"
                        value={field.value}
                        onBlur={field.onBlur}
                        onChange={(event) => field.onChange(event.target.value)}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
                <Controller
                  control={form.control}
                  name="awayUntil"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="rodizio-ferias-fim">Volta em</FieldLabel>
                      <Input
                        id="rodizio-ferias-fim"
                        name={field.name}
                        ref={field.ref}
                        type="datetime-local"
                        value={field.value}
                        onBlur={field.onBlur}
                        onChange={(event) => field.onChange(event.target.value)}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                    </Field>
                  )}
                />
              </div>
            </FieldSet>
          </FieldGroup>
        </form>

        {member ? (
          <>
            <FieldSeparator />
            <ShiftsSection member={member} />
          </>
        ) : (
          <Alert>
            <InfoIcon />
            <AlertTitle>A escala de plantão vem depois</AlertTitle>
            <AlertDescription>
              Salve o corretor na fila e abra este mesmo diálogo de novo para montar os horários de
              plantão. Sem escala, ele atende sempre.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Fechar
          </DialogClose>
          <Button type="submit" form="rodizio-corretor-form" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {member ? "Salvar corretor" : "Adicionar à fila"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
