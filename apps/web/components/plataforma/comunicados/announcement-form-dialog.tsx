"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_KIND_LABELS,
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_LIMITS,
  announcementFormSchema,
  normalizeAnnouncementLink,
  sanitizeAnnouncementText,
  toBrasiliaInputValue,
  type AnnouncementAudience,
  type AnnouncementFormValues,
} from "@workspace/core/platform/announcements"
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
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { saveAnnouncementAction } from "@/app/plataforma/comunicados/actions"
import { AnnouncementStrip } from "@/components/plataforma/comunicados/announcement-strip"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"

const KIND_ITEMS = ANNOUNCEMENT_KINDS.map((kind) => ({
  value: kind,
  label: ANNOUNCEMENT_KIND_LABELS[kind],
}))

const AUDIENCE_HINTS: Record<AnnouncementAudience, string> = {
  todos: "Qualquer pessoa logada no CRM de qualquer imobiliária.",
  donos_e_gerentes: "Só quem é dono ou gerente na imobiliária que está aberta.",
}

const DEFAULT_DURATION_MS = 7 * 24 * 60 * 60 * 1000

function newAnnouncementValues(): AnnouncementFormValues {
  const now = new Date()

  return {
    title: "",
    body: "",
    kind: "informacao",
    audience: "todos",
    startsAt: toBrasiliaInputValue(now),
    endsAt: toBrasiliaInputValue(new Date(now.getTime() + DEFAULT_DURATION_MS)),
    linkUrl: "",
    linkLabel: "",
  }
}

type AnnouncementFormDialogProps = {
  /** null = novo comunicado (botão "Novo comunicado"); com id, botão "Editar". */
  announcementId: string | null
  /** Valores do comunicado a editar; sem eles, começa agora e fica 7 dias. */
  initialValues?: AnnouncementFormValues
  /** Somente leitura: o botão fica desabilitado (o servidor recusa de qualquer jeito). */
  readOnly?: boolean
}

export function AnnouncementFormDialog({
  announcementId,
  initialValues,
  readOnly = false,
}: AnnouncementFormDialogProps) {
  const [open, setOpen] = React.useState(false)
  const isEditing = announcementId !== null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={isEditing ? "outline" : "default"}
            size={isEditing ? "sm" : "default"}
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        {isEditing ? (
          <PencilIcon data-icon="inline-start" />
        ) : (
          <PlusIcon data-icon="inline-start" />
        )}
        {isEditing ? "Editar" : "Novo comunicado"}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Monta a cada abertura: datas padrão calculadas na hora. */}
        {open ? (
          <AnnouncementForm
            announcementId={announcementId}
            initialValues={initialValues}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AnnouncementForm({
  announcementId,
  initialValues,
  onDone,
}: {
  announcementId: string | null
  initialValues?: AnnouncementFormValues
  onDone: () => void
}) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [defaultValues] = React.useState(() => initialValues ?? newAnnouncementValues())
  const isEditing = announcementId !== null

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    mode: "onTouched",
    defaultValues,
  })

  const [title, body, kind, linkUrl, linkLabel] = useWatch({
    control: form.control,
    name: ["title", "body", "kind", "linkUrl", "linkLabel"],
  })
  const previewLink = normalizeAnnouncementLink(linkUrl)
  const previewTitle = sanitizeAnnouncementText(title)
  const previewBody = sanitizeAnnouncementText(body)

  function onSubmit(values: AnnouncementFormValues) {
    setFormError(null)

    startSubmit(async () => {
      const result = await saveAnnouncementAction(values, announcementId)

      if (result.ok) {
        toast.add({ title: result.message, type: "success" })
        onDone()
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof AnnouncementFormValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Editar comunicado" : "Novo comunicado"}</DialogTitle>
        <DialogDescription>
          Aparece numa faixa discreta no topo do CRM das imobiliárias, só texto. Quem dispensar não
          vê de novo, mesmo depois de uma edição.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <Controller
            name="title"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="comunicado-titulo">Título</FieldLabel>
                <Input
                  {...field}
                  id="comunicado-titulo"
                  maxLength={ANNOUNCEMENT_LIMITS.titleMax}
                  placeholder="Ex.: Manutenção no domingo de madrugada"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Curto e direto: até {ANNOUNCEMENT_LIMITS.titleMax} caracteres.
                  </FieldDescription>
                )}
              </Field>
            )}
          />

          <Controller
            name="body"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="comunicado-texto">Texto</FieldLabel>
                <Textarea
                  {...field}
                  id="comunicado-texto"
                  rows={3}
                  maxLength={ANNOUNCEMENT_LIMITS.bodyMax}
                  placeholder="O que muda, quando e o que a imobiliária precisa fazer."
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    {field.value.length} de {ANNOUNCEMENT_LIMITS.bodyMax} caracteres. Sem HTML:
                    marcações são removidas.
                  </FieldDescription>
                )}
              </Field>
            )}
          />

          <Controller
            name="kind"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="comunicado-tipo">Tipo</FieldLabel>
                <Select
                  items={KIND_ITEMS}
                  value={field.value}
                  onValueChange={(value) => {
                    if (value) field.onChange(value)
                  }}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) field.onBlur()
                  }}
                >
                  <SelectTrigger
                    id="comunicado-tipo"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {KIND_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
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
            name="audience"
            control={form.control}
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid}>
                <FieldLegend variant="label">Quem vê</FieldLegend>
                <RadioGroup value={field.value} onValueChange={(value) => field.onChange(value)}>
                  {ANNOUNCEMENT_AUDIENCES.map((audience) => (
                    <FieldLabel key={audience} htmlFor={`comunicado-publico-${audience}`}>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldTitle>{ANNOUNCEMENT_AUDIENCE_LABELS[audience]}</FieldTitle>
                          <FieldDescription>{AUDIENCE_HINTS[audience]}</FieldDescription>
                        </FieldContent>
                        <RadioGroupItem value={audience} id={`comunicado-publico-${audience}`} />
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </FieldSet>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              name="startsAt"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="comunicado-inicio">Início</FieldLabel>
                  <Input
                    {...field}
                    id="comunicado-inicio"
                    type="datetime-local"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>Horário de Brasília.</FieldDescription>
                  )}
                </Field>
              )}
            />
            <Controller
              name="endsAt"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="comunicado-fim">Fim</FieldLabel>
                  <Input
                    {...field}
                    id="comunicado-fim"
                    type="datetime-local"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      Até {ANNOUNCEMENT_LIMITS.maxDurationDays} dias no ar.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
          </div>

          <Controller
            name="linkUrl"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="comunicado-link">Link (opcional)</FieldLabel>
                <Input
                  {...field}
                  id="comunicado-link"
                  type="url"
                  inputMode="url"
                  maxLength={ANNOUNCEMENT_LIMITS.linkMax}
                  placeholder="https://"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>Só links seguros (https). Abre em outra aba.</FieldDescription>
                )}
              </Field>
            )}
          />

          {previewLink.ok && previewLink.url ? (
            <Controller
              name="linkLabel"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="comunicado-link-texto">Texto do link (opcional)</FieldLabel>
                  <Input
                    {...field}
                    id="comunicado-link-texto"
                    maxLength={ANNOUNCEMENT_LIMITS.linkLabelMax}
                    placeholder="Saiba mais"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          ) : null}

          <Field>
            <FieldTitle>Prévia</FieldTitle>
            <AnnouncementStrip
              announcement={{
                title: previewTitle || "Título do comunicado",
                body: previewBody || "O texto aparece aqui.",
                kind,
                linkUrl: previewLink.ok ? previewLink.url : null,
                linkLabel: sanitizeAnnouncementText(linkLabel) || null,
              }}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            {isEditing ? "Salvar alterações" : "Publicar comunicado"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
