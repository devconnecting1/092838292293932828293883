"use client"

import * as React from "react"
import { CircleAlertIcon, HistoryIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { loadKeyHistory, type KeyHistoryItem } from "@/lib/chaves/actions"
import { formatDateTime } from "@/lib/format"

type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; movements: KeyHistoryItem[] }

type KeyHistorySheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyId: string | null
  keyTitle: string
}

export function KeyHistorySheet({ open, onOpenChange, keyId, keyTitle }: KeyHistorySheetProps) {
  const [state, setState] = React.useState<HistoryState>({ status: "loading" })
  const requestRef = React.useRef(0)

  React.useEffect(() => {
    if (!open || !keyId) return

    const request = ++requestRef.current

    loadKeyHistory(keyId)
      .then((result) => {
        if (request !== requestRef.current) return

        setState(
          result.ok
            ? { status: "ready", movements: result.movements }
            : { status: "error", message: result.error }
        )
      })
      .catch(() => {
        if (request !== requestRef.current) return
        setState({
          status: "error",
          message: "Não foi possível carregar o histórico agora.",
        })
      })

    return () => {
      requestRef.current += 1
      setState({ status: "loading" })
    }
  }, [open, keyId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Histórico da chave</SheetTitle>
          <SheetDescription>{keyTitle}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {state.status === "loading" ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <span className="sr-only">Carregando histórico…</span>
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : state.status === "error" ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível carregar</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : state.movements.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HistoryIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma retirada registrada</EmptyTitle>
                <EmptyDescription>
                  As retiradas e devoluções desta chave aparecem aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {state.movements.map((movement) => (
                <Item key={movement.id} variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>
                      {movement.takerLabel}
                      {movement.takerKind === "client" ? " (cliente)" : ""}
                    </ItemTitle>
                    <ItemDescription>
                      Retirada em {formatDateTime(movement.takenAt)}
                    </ItemDescription>
                    {movement.dueAt ? (
                      <ItemDescription
                        className={movement.isOverdue ? "text-destructive" : undefined}
                      >
                        Devolução prevista para {formatDateTime(movement.dueAt)}
                      </ItemDescription>
                    ) : null}
                    {movement.returnedAt ? (
                      <ItemDescription>
                        Devolvida em {formatDateTime(movement.returnedAt)}
                      </ItemDescription>
                    ) : null}
                    {movement.notes ? <ItemDescription>{movement.notes}</ItemDescription> : null}
                    {movement.registeredBy ? (
                      <ItemDescription>Registrada por {movement.registeredBy}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    {movement.returnedAt ? (
                      <Badge variant="secondary">Devolvida</Badge>
                    ) : movement.isOverdue ? (
                      <Badge variant="destructive">Vencida</Badge>
                    ) : (
                      <Badge>Em aberto</Badge>
                    )}
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
