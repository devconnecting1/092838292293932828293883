"use client"

import * as React from "react"
import Link from "next/link"
import {
  CalendarPlusIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  UserRoundPlusIcon,
} from "lucide-react"

import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"
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
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog"
import { DatePicker } from "@/components/agenda/date-picker"
import { toDateKey } from "@/lib/agenda/datetime"
import { canScheduleAppointments } from "@/lib/agenda/permissions"
import type { Role } from "@/lib/auth/roles"
import {
  CLIENT_SOURCE_LABELS,
  CLIENTS_PATH,
  LGPD_LEGAL_BASIS_LABELS,
  LGPD_LEGAL_BASIS_VALUES,
} from "@/lib/clientes/constants"
import { getMemberName, type ClientOption, type MemberOption } from "@/lib/clientes/options"
import { formatDate, formatDateTime } from "@/lib/format"
import {
  convertLeadToClient,
  findLeadClientCandidates,
  type ConvertLeadResult,
  type LeadClientCandidate,
} from "@/lib/leads/convert-actions"
import { LEAD_SOURCE_TO_CLIENT_SOURCE, LEAD_STAGE_LABELS } from "@/lib/leads/constants"
import type { LeadItem } from "@/lib/leads/types"

const NEW_CLIENT = "novo"

const LEGAL_BASIS_ITEMS = [
  { label: "Selecione a base legal", value: null },
  ...LGPD_LEGAL_BASIS_VALUES.map((basis) => ({
    label: LGPD_LEGAL_BASIS_LABELS[basis],
    value: basis,
  })),
]

const MATCH_LABELS: Record<"email" | "phone", string> = {
  email: "mesmo e-mail",
  phone: "mesmo telefone",
}

type CandidatesState =
  | { status: "loading" }
  | { status: "ready"; items: LeadClientCandidate[] }
  | { status: "error"; error: string }

export type ConvertLeadDialogProps = {
  lead: LeadItem
  members: MemberOption[]
  currentUserId: string
  role: Role
  /** O Dialog fica montado mesmo sem gatilho, para a tela de sucesso sobreviver à atualização. */
  showTrigger: boolean
  onConverted: (result: ConvertLeadResult) => void
  onVisitScheduled?: () => void
}

/** Clientes com o mesmo contato: os da busca e os apontados como possível duplicado. */
function mergeCandidates(state: CandidatesState, lead: LeadItem): LeadClientCandidate[] {
  const items = state.status === "ready" ? [...state.items] : []

  for (const duplicate of lead.duplicates) {
    if (duplicate.kind !== "client" || items.some((item) => item.id === duplicate.id)) continue

    items.push({
      id: duplicate.id,
      name: duplicate.name,
      kindLabel: "Cliente",
      matchedBy: duplicate.matchedBy,
      contactHint: null,
    })
  }

  return items
}

export function ConvertLeadDialog({ lead, showTrigger, ...props }: ConvertLeadDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [candidates, setCandidates] = React.useState<CandidatesState>({
    status: "loading",
  })
  const [, startLoading] = React.useTransition()
  const requestRef = React.useRef(0)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)

    if (!nextOpen) return

    const requestId = ++requestRef.current
    setCandidates({ status: "loading" })

    startLoading(async () => {
      const result = await findLeadClientCandidates(lead.id)

      if (requestId !== requestRef.current) return

      setCandidates(
        result.ok
          ? { status: "ready", items: result.data.candidates }
          : { status: "error", error: result.error }
      )
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger ? (
        <DialogTrigger render={<Button />}>
          <UserRoundPlusIcon data-icon="inline-start" />
          Converter em cliente
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <ConvertLeadForm {...props} lead={lead} candidates={candidates} />
      </DialogContent>
    </Dialog>
  )
}

function ConvertLeadForm({
  lead,
  members,
  currentUserId,
  role,
  candidates,
  onConverted,
  onVisitScheduled,
}: Omit<ConvertLeadDialogProps, "showTrigger"> & {
  candidates: CandidatesState
}) {
  const [choice, setChoice] = React.useState<string | null>(null)
  const [legalBasis, setLegalBasis] = React.useState("")
  const [consentDate, setConsentDate] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [result, setResult] = React.useState<ConvertLeadResult | null>(null)
  const [isSubmitting, startSubmit] = React.useTransition()

  const options = mergeCandidates(candidates, lead)
  // Com cliente de mesmo contato, sugerir o vínculo evita cadastro duplicado.
  const selected = choice ?? options[0]?.id ?? NEW_CLIENT
  const creating = selected === NEW_CLIENT
  const needsLegalBasis = creating && !lead.consentAt
  const assigneeName =
    lead.assignedTo !== null
      ? getMemberName(members, lead.assignedTo)
      : role === "broker"
        ? "você"
        : "sem responsável"

  if (result) {
    return (
      <ConvertLeadSuccess
        lead={lead}
        result={result}
        members={members}
        currentUserId={currentUserId}
        role={role}
        onVisitScheduled={onVisitScheduled}
      />
    )
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (needsLegalBasis && !legalBasis) {
      setFieldErrors({ legalBasis: "Selecione a base legal." })
      return
    }

    if (needsLegalBasis && legalBasis === "consent" && !consentDate) {
      setFieldErrors({ consentDate: "Informe a data do consentimento." })
      return
    }

    setFieldErrors({})

    startSubmit(async () => {
      const response = await convertLeadToClient({
        leadId: lead.id,
        clientId: creating ? null : selected,
        legalBasis: needsLegalBasis ? legalBasis : "",
        consentDate: needsLegalBasis && legalBasis === "consent" ? consentDate : "",
      })

      if (!response.ok) {
        setError(response.error)
        setFieldErrors(response.fieldErrors ?? {})
        return
      }

      toast.add({
        title: response.message ?? "Lead convertido em cliente.",
        type: "success",
      })
      setResult(response.data)
      onConverted(response.data)
    })
  }

  const nextStage =
    lead.stage === "new" || lead.stage === "contacted" ? LEAD_STAGE_LABELS.qualified : null

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Converter em cliente</DialogTitle>
        <DialogDescription>
          {lead.name}. Crie um cliente novo ou vincule a um cliente que já existe.
        </DialogDescription>
      </DialogHeader>

      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não foi possível converter</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Cliente</FieldLegend>
          {candidates.status === "loading" ? (
            <div className="flex flex-col gap-2" aria-busy>
              <span className="sr-only">Procurando clientes com o mesmo contato…</span>
              <Skeleton className="h-14 w-full" />
            </div>
          ) : null}
          {candidates.status === "error" ? (
            <FieldDescription>
              Não foi possível procurar clientes com o mesmo contato ({candidates.error}).
            </FieldDescription>
          ) : null}
          {options.length > 0 ? (
            <FieldDescription>
              Encontramos cliente(s) com o mesmo contato. Vincule ao cliente existente para não
              duplicar o cadastro.
            </FieldDescription>
          ) : null}
          <RadioGroup value={selected} onValueChange={(value) => setChoice(String(value))}>
            {options.map((candidate) => (
              <FieldLabel key={candidate.id} htmlFor={`converter-${candidate.id}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Vincular ao cliente existente: {candidate.name}</FieldTitle>
                    <FieldDescription>
                      {[
                        candidate.kindLabel,
                        candidate.matchedBy.map((reason) => MATCH_LABELS[reason]).join(" e "),
                        candidate.contactHint,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={candidate.id} id={`converter-${candidate.id}`} />
                </Field>
              </FieldLabel>
            ))}
            <FieldLabel htmlFor="converter-novo">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Criar novo cliente</FieldTitle>
                  <FieldDescription>
                    Origem {CLIENT_SOURCE_LABELS[LEAD_SOURCE_TO_CLIENT_SOURCE[lead.source]]},
                    responsável {assigneeName}. Os detalhes do lead vão para as observações.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value={NEW_CLIENT} id="converter-novo" />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </FieldSet>

        {creating ? (
          lead.consentAt ? (
            <Field>
              <FieldTitle>Base legal (LGPD)</FieldTitle>
              <FieldDescription>
                {lead.source === "landing_page"
                  ? `Consentimento, registrado no formulário em ${formatDateTime(lead.consentAt)}.`
                  : `Consentimento, informado pela equipe no cadastro do lead, dado em ${formatDate(lead.consentAt)}.`}
              </FieldDescription>
            </Field>
          ) : (
            <>
              <Field data-invalid={Boolean(fieldErrors.legalBasis)}>
                <FieldLabel htmlFor="converter-base-legal">Base legal (LGPD)</FieldLabel>
                <Select
                  items={LEGAL_BASIS_ITEMS}
                  value={legalBasis || null}
                  onValueChange={(value: string | null) => {
                    setLegalBasis(value ?? "")
                    if (value === "consent" && !consentDate) setConsentDate(toDateKey(new Date()))
                  }}
                >
                  <SelectTrigger
                    id="converter-base-legal"
                    className="w-full"
                    aria-invalid={Boolean(fieldErrors.legalBasis)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {LEGAL_BASIS_ITEMS.filter((item) => item.value !== null).map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldErrors.legalBasis ? (
                  <FieldError>{fieldErrors.legalBasis}</FieldError>
                ) : (
                  <FieldDescription>
                    Este lead não tem consentimento registrado. Escolha a base legal para tratar os
                    dados como cliente.
                  </FieldDescription>
                )}
              </Field>
              {legalBasis === "consent" ? (
                <Field data-invalid={Boolean(fieldErrors.consentDate)}>
                  <FieldLabel htmlFor="converter-consentimento">Data do consentimento</FieldLabel>
                  <DatePicker
                    id="converter-consentimento"
                    value={consentDate}
                    onChange={setConsentDate}
                    invalid={Boolean(fieldErrors.consentDate)}
                  />
                  {fieldErrors.consentDate ? (
                    <FieldError>{fieldErrors.consentDate}</FieldError>
                  ) : null}
                </Field>
              ) : null}
            </>
          )
        ) : null}

        <Field>
          <FieldTitle>O que acontece</FieldTitle>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground">
            <li>
              {creating
                ? "Cria o cliente com os dados de contato do lead."
                : "Vincula o lead ao cliente escolhido."}
            </li>
            {lead.property ? (
              <li>
                Cria um perfil de busca a partir do imóvel{" "}
                <span className="font-mono">{lead.property.code}</span>.
              </li>
            ) : null}
            {nextStage ? <li>Move o lead para {nextStage}.</li> : null}
            <li>Registra a conversão no histórico do cliente.</li>
          </ul>
        </Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSubmitting || candidates.status === "loading"}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {creating ? "Criar cliente" : "Vincular cliente"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ConvertLeadSuccess({
  lead,
  result,
  members,
  currentUserId,
  role,
  onVisitScheduled,
}: {
  lead: LeadItem
  result: ConvertLeadResult
  members: MemberOption[]
  currentUserId: string
  role: Role
  onVisitScheduled?: () => void
}) {
  const client: ClientOption = {
    id: result.clientId,
    label: result.clientName,
    description: CLIENT_KIND_LABELS[result.clientKind],
  }
  const property = lead.property
    ? {
        id: lead.property.id,
        label: `${lead.property.code} · ${lead.property.title}`,
        description: null,
      }
    : null

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {result.created ? "Lead convertido em cliente" : "Lead vinculado ao cliente"}
        </DialogTitle>
        <DialogDescription>
          <Badge variant="secondary">{result.clientName}</Badge> Agora dá para agendar a visita,
          registrar o histórico e acompanhar as propostas na ficha do cliente.
        </DialogDescription>
      </DialogHeader>

      {result.warning ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Conversão concluída com pendência</AlertTitle>
          <AlertDescription>{result.warning}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Fechar</DialogClose>
        <Button
          variant="outline"
          render={<Link href={`${CLIENTS_PATH}/${result.clientId}`} />}
          nativeButton={false}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Abrir ficha do cliente
        </Button>
        {canScheduleAppointments(role) ? (
          <AppointmentFormDialog
            members={members}
            currentUserId={currentUserId}
            role={role}
            defaults={{ client, property }}
            trigger={<Button />}
            onSaved={onVisitScheduled}
          >
            <CalendarPlusIcon data-icon="inline-start" />
            Agendar visita
          </AppointmentFormDialog>
        ) : null}
      </DialogFooter>
    </div>
  )
}
