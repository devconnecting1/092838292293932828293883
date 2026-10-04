"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PencilIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { CondominiumFormDialog } from "@/components/condominios/condominium-form-dialog"
import { deleteCondominiumAction } from "@/lib/condominios/actions"
import { formatPropertiesCount } from "@/lib/condominios/format"
import type { CondominiumFormSource } from "@/lib/condominios/schema"

type CondominiumDetailActionsProps = {
  condominium: CondominiumFormSource
  canEdit: boolean
  canDelete: boolean
  linkedPropertiesCount: number
}

export function CondominiumDetailActions({
  condominium,
  canEdit,
  canDelete,
  linkedPropertiesCount,
}: CondominiumDetailActionsProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [isDeleting, startDelete] = React.useTransition()

  function handleDelete() {
    startDelete(async () => {
      let result: Awaited<ReturnType<typeof deleteCondominiumAction>>

      try {
        result = await deleteCondominiumAction(condominium.id)
      } catch {
        toast.add({
          title: "Não foi possível excluir o condomínio",
          description:
            "Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.",
          type: "error",
        })
        return
      }

      if (!result) return

      if (!result.ok) {
        toast.add({
          title: "Não foi possível excluir o condomínio",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Condomínio excluído.",
        type: "success",
      })
      setDeleteOpen(false)
      router.push("/condominios")
    })
  }

  if (!canEdit && !canDelete) {
    return null
  }

  const linkedWarning =
    linkedPropertiesCount === 0
      ? "Nenhum imóvel está vinculado a este condomínio."
      : linkedPropertiesCount === 1
        ? "O imóvel vinculado continua cadastrado, mas fica sem condomínio."
        : `Os ${formatPropertiesCount(linkedPropertiesCount)} vinculados continuam cadastrados, mas ficam sem condomínio.`

  return (
    <div className="flex flex-wrap gap-2">
      {canEdit ? (
        <>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon data-icon="inline-start" />
            Editar
          </Button>
          <CondominiumFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            condominium={condominium}
          />
        </>
      ) : null}
      {canDelete ? (
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(nextOpen) => {
            if (!isDeleting) setDeleteOpen(nextOpen)
          }}
        >
          <AlertDialogTrigger render={<Button variant="destructive" />}>
            <Trash2Icon data-icon="inline-start" />
            Excluir
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <Trash2Icon />
              </AlertDialogMedia>
              <AlertDialogTitle>Excluir “{condominium.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {linkedWarning} Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                {isDeleting ? <Spinner data-icon="inline-start" /> : null}
                Excluir condomínio
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
