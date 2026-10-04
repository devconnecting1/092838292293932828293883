"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  LinkIcon,
  PencilIcon,
  PrinterIcon,
} from "lucide-react"

import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUS_VALUES,
  type PropertyStatus,
} from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { PropertyWhatsappShareButton } from "@/components/imoveis/detail/property-whatsapp-share-button"
import { MovePropertyToTrashButton } from "@/components/lixeira/move-property-to-trash-button"
import { changePropertyStatusAction } from "@/lib/imoveis/property-actions"

function isPropertyStatus(value: unknown): value is PropertyStatus {
  return typeof value === "string" && (PROPERTY_STATUS_VALUES as readonly string[]).includes(value)
}

/**
 * Ações da ficha do imóvel. Imprimir e compartilhar ficam para qualquer pessoa
 * que vê o imóvel; editar e mudar o status, só para quem pode editar.
 */
export function PropertyHeaderActions({
  propertyId,
  status,
  canEdit,
  requirementIssues,
  completeHref,
  whatsappHref,
  publicUrl,
  canDelete = false,
}: {
  propertyId: string
  status: PropertyStatus
  canEdit: boolean
  /** Dono e gerente: "Excluir" move para a lixeira. */
  canDelete?: boolean
  requirementIssues: string[]
  completeHref: string
  /** Link wa.me com o texto pronto (sem endereço nem dados do proprietário). */
  whatsappHref: string
  /** Página pública do imóvel; null quando o imóvel não está ativo. */
  publicUrl: string | null
}) {
  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      {canEdit ? (
        <PropertyEditActions
          propertyId={propertyId}
          status={status}
          requirementIssues={requirementIssues}
          completeHref={completeHref}
        />
      ) : null}
      {publicUrl ? <CopyPublicLinkButton url={publicUrl} /> : null}
      <Button
        variant="outline"
        // ?abrir=1: PDF inline, aberto no visualizador do navegador (a rota tem CSP própria).
        render={
          <a
            href={`/api/imoveis/${propertyId}/ficha?abrir=1`}
            target="_blank"
            rel="noopener noreferrer"
          />
        }
        nativeButton={false}
      >
        <PrinterIcon data-icon="inline-start" />
        Imprimir ficha
        <span className="sr-only"> (abre o PDF em nova aba)</span>
      </Button>
      <PropertyWhatsappShareButton
        propertyId={propertyId}
        whatsappHref={whatsappHref}
        publicUrl={publicUrl}
      />
      {canDelete ? <MovePropertyToTrashButton propertyId={propertyId} /> : null}
    </div>
  )
}

function CopyPublicLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.add({ title: "Link público copiado.", type: "success" })
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.add({
        title: "Não foi possível copiar",
        description: url,
        type: "error",
      })
    }
  }

  return (
    <Button variant="outline" onClick={copyLink}>
      {copied ? <CheckIcon data-icon="inline-start" /> : <LinkIcon data-icon="inline-start" />}
      {copied ? "Copiado" : "Copiar link público"}
    </Button>
  )
}

function PropertyEditActions({
  propertyId,
  status,
  requirementIssues,
  completeHref,
}: {
  propertyId: string
  status: PropertyStatus
  requirementIssues: string[]
  completeHref: string
}) {
  const [isPending, startTransition] = React.useTransition()
  const [optimisticStatus, setOptimisticStatus] = React.useOptimistic(status)
  const hasIssues = requirementIssues.length > 0

  function handleStatusChange(next: unknown) {
    if (!isPropertyStatus(next) || next === optimisticStatus) return

    startTransition(async () => {
      setOptimisticStatus(next)
      const result = await changePropertyStatusAction(propertyId, next)

      if (result.ok) {
        toast.add({
          title: result.message ?? "Status alterado.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível alterar o status",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  return (
    <>
      <Button
        variant="outline"
        render={<Link href={`/imoveis/${propertyId}/editar`} />}
        nativeButton={false}
      >
        <PencilIcon data-icon="inline-start" />
        Editar
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={isPending} />}>
          {isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowRightLeftIcon data-icon="inline-start" />
          )}
          {PROPERTY_STATUS_LABELS[optimisticStatus]}
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Alterar status</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={optimisticStatus} onValueChange={handleStatusChange}>
              {PROPERTY_STATUS_VALUES.map((value) => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  disabled={value !== "draft" && hasIssues}
                >
                  {PROPERTY_STATUS_LABELS[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {hasIssues ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal whitespace-normal">
                  Para sair do rascunho: {requirementIssues.join(" ")}
                </DropdownMenuLabel>
                <DropdownMenuItem render={<Link href={completeHref} />}>
                  <PencilIcon />
                  Completar cadastro
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
