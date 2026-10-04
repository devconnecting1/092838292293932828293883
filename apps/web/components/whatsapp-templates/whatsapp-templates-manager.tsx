"use client"

import * as React from "react"
import { MessageSquareTextIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import {
  findUnknownTemplateVariables,
  renderWhatsappTemplate,
  WHATSAPP_TEMPLATE_BODY_MAX_LENGTH,
  WHATSAPP_TEMPLATE_TITLE_MAX_LENGTH,
  WHATSAPP_TEMPLATE_VARIABLE_HINTS,
  WHATSAPP_TEMPLATE_VARIABLES,
  WHATSAPP_TEMPLATES_MAX,
} from "@workspace/core/leads/whatsapp-message"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { deleteWhatsappTemplate, saveWhatsappTemplate } from "@/lib/whatsapp-templates/actions"
import type { WhatsappTemplate } from "@/lib/whatsapp-templates/constants"
import type { WhatsappTemplateValues } from "@/lib/whatsapp-templates/schemas"

/** Valores de exemplo da prévia (nenhum dado real de cliente). */
const PREVIEW_VALUES = {
  nome: "Maria",
  imovel: "Apartamento 2 quartos (código IMV-000123)",
  corretor: "Carlos",
  link: "https://sua-imobiliaria.exemplo/imovel/IMV-000123",
}

type WhatsappTemplatesManagerProps = {
  templates: WhatsappTemplate[]
  canEdit: boolean
}

/** Lista, criação, edição e exclusão dos modelos de mensagem de WhatsApp. */
export function WhatsappTemplatesManager({ templates, canEdit }: WhatsappTemplatesManagerProps) {
  const atLimit = templates.length >= WHATSAPP_TEMPLATES_MAX

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {templates.length} de {WHATSAPP_TEMPLATES_MAX} modelos
          </p>
          <TemplateFormDialog trigger={<Button disabled={atLimit} />}>
            <PlusIcon data-icon="inline-start" />
            Novo modelo
          </TemplateFormDialog>
        </div>
      ) : null}

      {templates.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareTextIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum modelo ainda</EmptyTitle>
            <EmptyDescription>
              {canEdit
                ? "Crie mensagens prontas para “confirmar visita”, “pedir documentos” ou “enviar localização”. Elas aparecem no botão de WhatsApp do lead e do imóvel."
                : "A gestão ainda não criou modelos. Enquanto isso, o botão de WhatsApp usa a mensagem pronta do sistema."}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent>
              <TemplateFormDialog trigger={<Button variant="outline" />}>
                <PlusIcon data-icon="inline-start" />
                Criar o primeiro modelo
              </TemplateFormDialog>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <ul className="grid gap-4 @min-[48rem]/page:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id}>
              <TemplateCard template={template} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TemplateCard({ template, canEdit }: { template: WhatsappTemplate; canEdit: boolean }) {
  const [isDeleting, startDeleting] = React.useTransition()

  function remove() {
    startDeleting(async () => {
      const result = await deleteWhatsappTemplate(template.id)

      toast.add(
        result.ok
          ? { title: result.message ?? "Modelo apagado.", type: "success" }
          : { title: "Não foi possível apagar", description: result.error, type: "error" }
      )
    })
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="break-words">{template.title}</CardTitle>
        <CardDescription className="line-clamp-4 break-words whitespace-pre-line">
          {template.body}
        </CardDescription>
      </CardHeader>
      {canEdit ? (
        <CardFooter className="mt-auto flex flex-wrap gap-2">
          <TemplateFormDialog template={template} trigger={<Button variant="outline" size="sm" />}>
            <PencilIcon data-icon="inline-start" />
            Editar
          </TemplateFormDialog>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={isDeleting} />}>
              {isDeleting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Apagar
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar o modelo “{template.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ele some do botão de WhatsApp de toda a equipe. As mensagens já enviadas não
                  mudam.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={remove}>
                  Apagar modelo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function TemplateFormDialog({
  template,
  trigger,
  children,
}: {
  template?: WhatsappTemplate
  /** Botão que abre o diálogo (sem conteúdo: o rótulo vem em children). */
  trigger: React.ReactElement
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {/* Montado a cada abertura: o formulário recomeça do modelo salvo. */}
        <TemplateForm template={template} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function TemplateForm({ template, onSaved }: { template?: WhatsappTemplate; onSaved: () => void }) {
  const titleId = React.useId()
  const bodyId = React.useId()
  const [values, setValues] = React.useState<WhatsappTemplateValues>({
    title: template?.title ?? "",
    body: template?.body ?? "",
  })
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof WhatsappTemplateValues, string>>
  >({})
  const [isSaving, startSaving] = React.useTransition()
  const unknownVariables = findUnknownTemplateVariables(values.body)
  const preview = values.body.trim() ? renderWhatsappTemplate(values.body, PREVIEW_VALUES) : ""

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    startSaving(async () => {
      const result = await saveWhatsappTemplate(values, template?.id ?? null)

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        toast.add({ title: "Não foi possível salvar", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Modelo salvo.", type: "success" })
      onSaved()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{template ? "Editar modelo" : "Novo modelo"}</DialogTitle>
        <DialogDescription>
          Toda a equipe usa o modelo no botão de WhatsApp. As variáveis viram os dados do lead e do
          imóvel na hora de enviar.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field data-invalid={Boolean(fieldErrors.title) || undefined}>
          <FieldLabel htmlFor={titleId}>Título</FieldLabel>
          <Input
            id={titleId}
            value={values.title}
            maxLength={WHATSAPP_TEMPLATE_TITLE_MAX_LENGTH}
            placeholder="Confirmar visita"
            aria-invalid={Boolean(fieldErrors.title) || undefined}
            onChange={(event) =>
              setValues((current) => ({ ...current, title: event.target.value }))
            }
          />
          {fieldErrors.title ? <FieldError>{fieldErrors.title}</FieldError> : null}
        </Field>

        <Field data-invalid={Boolean(fieldErrors.body) || undefined}>
          <FieldLabel htmlFor={bodyId}>Mensagem</FieldLabel>
          <Textarea
            id={bodyId}
            rows={6}
            value={values.body}
            maxLength={WHATSAPP_TEMPLATE_BODY_MAX_LENGTH}
            placeholder="Olá, {nome}! Aqui é {corretor}. Confirmo nossa visita ao {imovel}. Detalhes: {link}"
            aria-invalid={Boolean(fieldErrors.body) || undefined}
            onChange={(event) => setValues((current) => ({ ...current, body: event.target.value }))}
          />
          {fieldErrors.body ? <FieldError>{fieldErrors.body}</FieldError> : null}
          <FieldDescription>
            {values.body.length.toLocaleString("pt-BR")} de 1.000 caracteres.
          </FieldDescription>
          <div className="flex flex-wrap gap-1.5">
            {WHATSAPP_TEMPLATE_VARIABLES.map((variable) => (
              <Badge
                key={variable}
                variant="outline"
                title={WHATSAPP_TEMPLATE_VARIABLE_HINTS[variable]}
              >
                {`{${variable}}`} · {WHATSAPP_TEMPLATE_VARIABLE_HINTS[variable]}
              </Badge>
            ))}
          </div>
          {unknownVariables.length > 0 ? (
            <FieldDescription className="text-destructive">
              {unknownVariables.join(", ")} não{" "}
              {unknownVariables.length === 1 ? "é variável" : "são variáveis"} e vai aparecer como
              está na mensagem.
            </FieldDescription>
          ) : null}
        </Field>

        {preview ? (
          <Card size="sm" className="bg-muted/50">
            <CardHeader>
              <CardTitle className="text-sm">Prévia com dados de exemplo</CardTitle>
              <CardAction>
                <Badge variant="secondary">Exemplo</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm break-words whitespace-pre-line">{preview}</p>
            </CardContent>
          </Card>
        ) : null}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          {template ? "Salvar alterações" : "Criar modelo"}
        </Button>
      </DialogFooter>
    </form>
  )
}
