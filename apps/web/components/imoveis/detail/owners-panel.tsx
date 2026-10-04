"use client"

import * as React from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  InboxIcon,
  PencilIcon,
  PercentIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { formatDateTime } from "@/lib/format"
import { formatPercent, formatPhone } from "@/components/imoveis/detail/format"
import { OwnerClientCombobox } from "@/components/imoveis/detail/owner-client-combobox"
import {
  addOwnerFormSchema,
  formatPercentInput,
  ownerShareFormSchema,
  type AddOwnerFormValues,
  type OwnerShareFormValues,
} from "@/components/imoveis/detail/schemas"
import type { CaptureOwnerInfo, OwnerItem } from "@/components/imoveis/detail/types"
import {
  addPropertyOwnerAction,
  removePropertyOwnerAction,
  updatePropertyOwnerShareAction,
} from "@/lib/imoveis/owner-actions"

export function OwnersPanel({
  propertyId,
  owners,
  capture,
  canEdit,
  canDelete,
}: {
  propertyId: string
  owners: OwnerItem[]
  capture: CaptureOwnerInfo | null
  canEdit: boolean
  canDelete: boolean
}) {
  const shares = owners
    .map((owner) => owner.sharePercent)
    .filter((value): value is number => value != null)
  const total = Math.round(shares.reduce((sum, value) => sum + value, 0) * 100) / 100
  const hasShares = shares.length > 0
  const missingShares = hasShares && shares.length < owners.length
  const sumIsOff = hasShares && total !== 100

  return (
    <div className="flex flex-col gap-4">
      {capture ? (
        <Alert>
          <InboxIcon />
          <AlertTitle>Imóvel originado de uma captação</AlertTitle>
          <AlertDescription>
            <p>
              Proprietário informado em {formatDateTime(capture.createdAt)}:{" "}
              <strong>{capture.ownerName}</strong>
              {capture.ownerEmail ? ` · ${capture.ownerEmail}` : ""}
              {capture.ownerPhone ? ` · ${formatPhone(capture.ownerPhone)}` : ""}.
            </p>
            <p>
              Se ele ainda não é cliente, <Link href="/clientes/novo">cadastre-o como cliente</Link>{" "}
              e adicione-o aqui como proprietário.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Proprietários</CardTitle>
          <CardDescription>Clientes donos do imóvel e a participação de cada um.</CardDescription>
          <CardAction className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/clientes/novo" />}
              nativeButton={false}
            >
              Cadastrar cliente
            </Button>
            {canEdit ? (
              <AddOwnerDialog
                propertyId={propertyId}
                existingClientIds={owners.map((owner) => owner.clientId)}
              />
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {owners.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhum proprietário cadastrado</EmptyTitle>
                <EmptyDescription>
                  Vincule os clientes donos do imóvel. Eles são necessários para registrar a
                  autorização de venda ou locação.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {owners.map((owner) => (
                <Item key={owner.id} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      {owner.clientName ? (
                        <Link href={`/clientes/${owner.clientId}`} className="hover:underline">
                          {owner.clientName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Cliente sem acesso</span>
                      )}
                    </ItemTitle>
                    {owner.clientKind ? (
                      <ItemDescription>{CLIENT_KIND_LABELS[owner.clientKind]}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Badge
                      variant={owner.sharePercent == null ? "outline" : "secondary"}
                      className="tabular-nums"
                    >
                      {owner.sharePercent == null
                        ? "Sem percentual"
                        : formatPercent(owner.sharePercent)}
                    </Badge>
                    {canEdit ? <OwnerShareDialog propertyId={propertyId} owner={owner} /> : null}
                    {canDelete ? <RemoveOwnerButton propertyId={propertyId} owner={owner} /> : null}
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}

          {sumIsOff || missingShares ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Confira as participações</AlertTitle>
              <AlertDescription>
                {sumIsOff
                  ? `As participações somam ${formatPercent(total)}; o esperado é 100%.`
                  : null}
                {sumIsOff && missingShares ? " " : null}
                {missingShares ? "Há proprietários sem percentual informado." : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        {hasShares ? (
          <CardFooter className="justify-between gap-2">
            <span className="text-muted-foreground">Soma das participações</span>
            <span className="font-medium tabular-nums">{formatPercent(total)}</span>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  )
}

const ADD_OWNER_DEFAULTS: AddOwnerFormValues = {
  client: null,
  sharePercent: "",
}

function AddOwnerDialog({
  propertyId,
  existingClientIds,
}: {
  propertyId: string
  existingClientIds: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const form = useForm<AddOwnerFormValues>({
    resolver: zodResolver(addOwnerFormSchema),
    defaultValues: ADD_OWNER_DEFAULTS,
  })

  function handleOpenChange(next: boolean) {
    if (next) form.reset(ADD_OWNER_DEFAULTS)
    setOpen(next)
  }

  function onSubmit(values: AddOwnerFormValues) {
    const client = values.client
    if (!client) return

    if (existingClientIds.includes(client.id)) {
      form.setError("client", {
        type: "manual",
        message: "Este cliente já é proprietário deste imóvel.",
      })
      return
    }

    startTransition(async () => {
      const result = await addPropertyOwnerAction(propertyId, {
        clientId: client.id,
        sharePercent: values.sharePercent,
      })

      if (result.ok) {
        setOpen(false)
        toast.add({
          title: result.message ?? "Proprietário adicionado.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível adicionar o proprietário",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlusIcon data-icon="inline-start" />
        Adicionar
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Adicionar proprietário</DialogTitle>
            <DialogDescription>
              Busque um cliente já cadastrado. Se ele não aparecer,{" "}
              <Link href="/clientes/novo">cadastre o cliente</Link> primeiro.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              name="client"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="proprietario-cliente">Cliente</FieldLabel>
                  <OwnerClientCombobox
                    id="proprietario-cliente"
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    excludeIds={existingClientIds}
                    invalid={fieldState.invalid}
                    disabled={isPending}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            <Controller
              name="sharePercent"
              control={form.control}
              render={({ field, fieldState }) => (
                <SharePercentField
                  id="proprietario-participacao"
                  disabled={isPending}
                  field={field}
                  fieldState={fieldState}
                />
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type SharePercentFieldProps = {
  id: string
  disabled?: boolean
  field: {
    name: string
    value: string
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    onBlur: () => void
    ref: React.Ref<HTMLInputElement>
  }
  fieldState: { invalid: boolean; error?: { message?: string } }
}

/** Campo de participação (%) usado nos formulários de adicionar e editar. */
function SharePercentField({ id, disabled, field, fieldState }: SharePercentFieldProps) {
  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={id}>Participação (opcional)</FieldLabel>
      <InputGroup>
        <InputGroupInput
          {...field}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ex.: 50"
          disabled={disabled}
          aria-invalid={fieldState.invalid}
        />
        <InputGroupAddon align="inline-end">
          <PercentIcon />
        </InputGroupAddon>
      </InputGroup>
      {fieldState.invalid ? (
        <FieldError errors={[fieldState.error]} />
      ) : (
        <FieldDescription>Percentual do imóvel que pertence a este proprietário.</FieldDescription>
      )}
    </Field>
  )
}

function OwnerShareDialog({ propertyId, owner }: { propertyId: string; owner: OwnerItem }) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const form = useForm<OwnerShareFormValues>({
    resolver: zodResolver(ownerShareFormSchema),
    defaultValues: { sharePercent: formatPercentInput(owner.sharePercent) },
  })

  function handleOpenChange(next: boolean) {
    if (next) form.reset({ sharePercent: formatPercentInput(owner.sharePercent) })
    setOpen(next)
  }

  function onSubmit(values: OwnerShareFormValues) {
    startTransition(async () => {
      const result = await updatePropertyOwnerShareAction(propertyId, owner.id, values.sharePercent)

      if (result.ok) {
        setOpen(false)
        toast.add({
          title: result.message ?? "Participação atualizada.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível alterar a participação",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  const ownerName = owner.clientName ?? "este proprietário"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <PencilIcon />
        <span className="sr-only">Editar participação de {ownerName}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Editar participação</DialogTitle>
            <DialogDescription>
              Percentual de {ownerName} no imóvel. Deixe em branco para não informar.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              name="sharePercent"
              control={form.control}
              render={({ field, fieldState }) => (
                <SharePercentField
                  id={`participacao-${owner.id}`}
                  disabled={isPending}
                  field={field}
                  fieldState={fieldState}
                />
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveOwnerButton({ propertyId, owner }: { propertyId: string; owner: OwnerItem }) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const ownerName = owner.clientName ?? "este proprietário"

  function handleConfirm() {
    startTransition(async () => {
      const result = await removePropertyOwnerAction(propertyId, owner.id)

      if (result.ok) {
        setOpen(false)
        toast.add({
          title: result.message ?? "Proprietário removido.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível remover o proprietário",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Trash2Icon />
        <span className="sr-only">Remover {ownerName}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover proprietário?</AlertDialogTitle>
          <AlertDialogDescription>
            {ownerName} deixa de constar como proprietário deste imóvel. O cadastro do cliente e as
            autorizações já registradas continuam existindo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
