"use client"

import * as React from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { KeyFormDialog } from "@/components/chaves/key-form-dialog"
import type { ComboboxOption } from "@/components/propostas/option-combobox"

export function NewKeyButton({
  properties,
  defaultPropertyId,
  variant = "default",
}: {
  properties: ComboboxOption[]
  defaultPropertyId?: string
  variant?: "default" | "outline"
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Cadastrar chave
      </Button>
      <KeyFormDialog
        open={open}
        onOpenChange={setOpen}
        properties={properties}
        defaultPropertyId={defaultPropertyId}
      />
    </>
  )
}
