"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Building2Icon,
  EraserIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserIcon,
  UserRoundSearchIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { TypedConfirmDialog } from "@/components/lixeira/typed-confirm-dialog"
import { formatDate } from "@/lib/format"
import { anonymizeFromTrash, purgeFromTrash, restoreFromTrash } from "@/lib/lixeira/actions"
import {
  ANONYMIZATION_SUMMARY,
  describeLegalHolds,
  formatPlainDate,
  LEGAL_HOLD_EXPLANATION,
  TRASH_ENTITY_LABELS,
  type TrashEntity,
} from "@/lib/lixeira/constants"
import type { TrashItem } from "@/lib/lixeira/queries"

const ENTITY_ICONS: Record<TrashEntity, React.ComponentType> = {
  lead: UserRoundSearchIcon,
  client: UserIcon,
  property: Building2Icon,
}

function itemTitle(item: TrashItem) {
  return item.code ? `${item.code} · ${item.label}` : item.label
}

type Dialog = { kind: "purge" | "anonymize"; item: TrashItem } | null

export function TrashList({ items }: { items: TrashItem[] }) {
  const router = useRouter()
  const [dialog, setDialog] = React.useState<Dialog>(null)
  const [restoringId, setRestoringId] = React.useState<string | null>(null)
  const [, startRestore] = React.useTransition()

  const pending = items.filter((item) => !item.anonymizedAt)
  const anonymized = items.filter((item) => item.anonymizedAt)

  function restore(item: TrashItem) {
    setRestoringId(item.id)
    startRestore(async () => {
      const result = await restoreFromTrash(item.entity, item.id)
      setRestoringId(null)

      if (!result.ok) {
        toast.add({ title: "Não foi possível restaurar", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Restaurado.", type: "success" })
      router.refresh()
    })
  }

  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trash2Icon />
          </EmptyMedia>
          <EmptyTitle>A lixeira está vazia</EmptyTitle>
          <EmptyDescription>
            Leads, clientes e imóveis excluídos ficam aqui por 30 dias antes de serem apagados de
            vez.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 ? (
        <ItemGroup className="gap-3">
          {pending.map((item) => {
            const Icon = ENTITY_ICONS[item.entity]
            const hasHold = item.legalHolds.length > 0

            return (
              <Item key={`${item.entity}-${item.id}`} variant="outline" className="flex-wrap">
                <ItemMedia variant="icon">
                  <Icon />
                </ItemMedia>
                <ItemContent className="min-w-0 basis-56">
                  <ItemTitle className="flex-wrap">
                    <span className="break-words">{itemTitle(item)}</span>
                    <Badge variant="outline">{TRASH_ENTITY_LABELS[item.entity]}</Badge>
                    {hasHold ? <Badge variant="secondary">Guarda legal</Badge> : null}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    Excluído em {formatDate(item.deletedAt)}
                    {item.deletedByName ? ` por ${item.deletedByName}` : ""}.{" "}
                    {hasHold
                      ? `Tem ${describeLegalHolds(item.legalHolds)}: em ${formatDate(item.purgeAfter)} os dados pessoais serão anonimizados.`
                      : `Será apagado de vez em ${formatDate(item.purgeAfter)}.`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="w-full flex-wrap sm:w-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoringId === item.id}
                    onClick={() => restore(item)}
                  >
                    {restoringId === item.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <RotateCcwIcon data-icon="inline-start" />
                    )}
                    Restaurar
                  </Button>
                  {hasHold && item.entity !== "lead" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ kind: "anonymize", item })}
                    >
                      <EraserIcon data-icon="inline-start" />
                      Anonimizar dados pessoais
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ kind: "purge", item })}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Excluir permanentemente
                    </Button>
                  )}
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      ) : null}

      {anonymized.length > 0 ? (
        <section aria-labelledby="lixeira-guarda-legal" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="lixeira-guarda-legal" className="text-sm font-medium">
              Anonimizados em guarda legal
            </h2>
            <p className="text-sm text-muted-foreground">
              Ficam bloqueados, fora das telas, só com o que a lei obriga a guardar. Não voltam para
              o CRM.
            </p>
          </div>
          <ItemGroup className="gap-3">
            {anonymized.map((item) => {
              const Icon = ENTITY_ICONS[item.entity]
              return (
                <Item key={`${item.entity}-${item.id}`} variant="muted" size="sm">
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="flex-wrap">
                      <span className="break-words">{itemTitle(item)}</span>
                      <Badge variant="outline">
                        <ShieldCheckIcon data-icon="inline-start" />
                        Anonimizado
                      </Badge>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      Anonimizado em {formatDate(item.anonymizedAt)}. Guardado por:{" "}
                      {describeLegalHolds(item.legalHolds) || "obrigação legal"}.
                      {item.identificationKeptUntil
                        ? ` Nome e CPF/CNPJ saem em ${formatPlainDate(item.identificationKeptUntil)}.`
                        : ""}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              )
            })}
          </ItemGroup>
        </section>
      ) : null}

      {dialog ? (
        <TypedConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          title={
            dialog.kind === "purge"
              ? `Excluir permanentemente ${TRASH_ENTITY_LABELS[dialog.item.entity].toLowerCase()}?`
              : "Anonimizar dados pessoais?"
          }
          expected={dialog.item.label}
          alternative={dialog.item.code}
          confirmLabel={dialog.kind === "purge" ? "Excluir permanentemente" : "Anonimizar"}
          action={(typed) =>
            dialog.kind === "purge"
              ? purgeFromTrash(dialog.item.entity, dialog.item.id, typed)
              : anonymizeFromTrash(dialog.item.entity, dialog.item.id, typed)
          }
          onDone={() => router.refresh()}
        >
          {dialog.kind === "purge" ? (
            <p>
              {itemTitle(dialog.item)} e tudo o que está ligado a ele (histórico, visitas, tarefas,
              propostas, fotos e documentos) serão apagados agora. Esta ação não pode ser desfeita.
            </p>
          ) : (
            <>
              <p>
                {itemTitle(dialog.item)} tem {describeLegalHolds(dialog.item.legalHolds)}, então não
                pode ser apagado por inteiro.
              </p>
              <p>
                {ANONYMIZATION_SUMMARY[dialog.item.entity === "property" ? "property" : "client"]}
              </p>
              <p>{LEGAL_HOLD_EXPLANATION}</p>
            </>
          )}
        </TypedConfirmDialog>
      ) : null}
    </div>
  )
}
