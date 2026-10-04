"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { CondominiumFormDialog } from "@/components/condominios/condominium-form-dialog"

/** Abre o cadastro e, ao salvar, leva para a ficha do condomínio criado. */
export function NewCondominiumButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Novo condomínio
      </Button>
      <CondominiumFormDialog
        open={open}
        onOpenChange={setOpen}
        onSaved={(id) => router.push(`/condominios/${id}`)}
      />
    </>
  )
}
