"use client"

import * as React from "react"
import type { FieldValues, UseFormReturn } from "react-hook-form"

import {
  buildFormDraftKey,
  formatFormDraftSavedAt,
  hasDraftableChanges,
  mergeFormDraftValues,
  parseFormDraft,
  sanitizeDraftValues,
  serializeFormDraft,
  type DraftJsonObject,
  type FormDraft,
  type FormDraftScope,
} from "@workspace/core/forms/draft"

import {
  readDraftRaw,
  removeDraftRaw,
  sweepStaleDrafts,
  writeDraftRaw,
} from "@/lib/forms/draft/storage"

/** Espera depois da última digitação antes de gravar. */
export const FORM_DRAFT_SAVE_DELAY_MS = 800

export type FormDraftOffer = {
  savedAt: Date
  /** "16/09 às 14:05" */
  savedAtLabel: string
}

export type FormDraftControls = {
  /** Rascunho encontrado ao abrir, esperando "Recuperar" ou "Descartar". */
  offer: FormDraftOffer | null
  restore: () => void
  discard: () => void
  /** Depois de salvar com sucesso: apaga o rascunho. */
  clear: () => void
  /** Grava já, sem esperar a pausa na digitação (ex.: falha ao salvar). */
  saveNow: () => void
}

export type UseFormDraftOptions<T extends FieldValues> = {
  form: UseFormReturn<T>
  /** Usuário + imobiliária. Sem escopo, não há rascunho. */
  scope: FormDraftScope | null | undefined
  /** Identificador estável do formulário (ex.: "imovel"). */
  formId: string
  /** Registro em edição; null no cadastro novo. */
  recordId?: string | null
  /** Campos extras que nunca vão para o rascunho (CPF, RG, senhas já saem sempre). */
  exclude?: readonly string[]
  /** Desliga o rascunho (ex.: formulário só de leitura). */
  enabled?: boolean
  delayMs?: number
}

type DraftReader = { cache: Map<string, FormDraft | null> }

/**
 * Rascunho que havia no storage quando este formulário montou. Fica congelado
 * por instância: o salvamento automático não faz o aviso reaparecer, e
 * reabrir o formulário (nova instância) lê de novo.
 */
function readInitialDraft(
  reader: DraftReader,
  key: string | null,
  exclude: readonly string[] | undefined
): FormDraft | null {
  if (!key) return null

  if (!reader.cache.has(key)) {
    reader.cache.set(key, parseFormDraft(readDraftRaw(key), new Date(), { exclude }))
  }

  return reader.cache.get(key) ?? null
}

// O rascunho inicial não muda depois de lido: não há o que assinar.
const subscribeToNothing = () => () => {}
const getServerDraft = () => null

/**
 * Guarda o que foi digitado no localStorage (com espera após a digitação),
 * por usuário + imobiliária + formulário + registro, por até 7 dias. CPF, RG,
 * documentos e senhas nunca são gravados. Ao abrir com rascunho, `offer`
 * traz a data para o aviso "Recuperar | Descartar"; enquanto a pessoa não
 * decide, nada é sobrescrito.
 */
export function useFormDraft<T extends FieldValues>({
  form,
  scope,
  formId,
  recordId = null,
  exclude,
  enabled = true,
  delayMs = FORM_DRAFT_SAVE_DELAY_MS,
}: UseFormDraftOptions<T>): FormDraftControls {
  const key = enabled && scope ? buildFormDraftKey({ ...scope, formId, recordId }) : null
  const [reader] = React.useState<DraftReader>(() => ({ cache: new Map() }))
  const initialDraft = React.useSyncExternalStore(
    subscribeToNothing,
    () => readInitialDraft(reader, key, exclude),
    getServerDraft
  )
  const [decidedKey, setDecidedKey] = React.useState<string | null>(null)
  const pendingDraft = key !== null && decidedKey !== key ? initialDraft : null

  const latestRef = React.useRef({ key, exclude, delayMs, paused: pendingDraft !== null })
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Valores no momento do clear(): só volta a gravar quando algo mudar de novo.
  const clearedRef = React.useRef<DraftJsonObject | null>(null)

  React.useEffect(() => {
    latestRef.current = { key, exclude, delayMs, paused: pendingDraft !== null }
  })

  const cancelTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const persist = React.useCallback(() => {
    cancelTimer()
    const { key: currentKey, exclude: currentExclude, paused } = latestRef.current

    // Com aviso pendente, gravar apagaria o rascunho que a pessoa ainda pode recuperar.
    if (!currentKey || paused) return

    const values = form.getValues()
    const options = { exclude: currentExclude }

    if (clearedRef.current) {
      if (!hasDraftableChanges(values, clearedRef.current, options)) return
      clearedRef.current = null
    }

    if (!hasDraftableChanges(values, form.formState.defaultValues, options)) {
      removeDraftRaw(currentKey)
      return
    }

    const raw = serializeFormDraft(values, new Date(), options)
    if (raw) writeDraftRaw(currentKey, raw)
  }, [cancelTimer, form])

  const schedule = React.useCallback(() => {
    if (!latestRef.current.key) return
    cancelTimer()
    timerRef.current = setTimeout(persist, latestRef.current.delayMs)
  }, [cancelTimer, persist])

  React.useEffect(() => {
    if (!key) return

    sweepStaleDrafts()

    const unsubscribe = form.subscribe({ formState: { values: true }, callback: schedule })

    function flushPending() {
      if (timerRef.current !== null) persist()
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushPending()
    }

    // Fechar a aba ou trocar de app no celular no meio da espera não perde a digitação.
    window.addEventListener("pagehide", flushPending)
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener("pagehide", flushPending)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      // Diálogo fechado ou troca de registro dentro da espera.
      flushPending()
    }
  }, [key, form, schedule, persist])

  const restore = React.useCallback(() => {
    if (!key || !initialDraft) return

    const merged = mergeFormDraftValues(form.getValues(), initialDraft.values, { exclude })
    setDecidedKey(key)
    clearedRef.current = null
    // keepDefaultValues: o formulário fica "alterado" em relação ao salvo, e o aviso de saída vale.
    form.reset(merged, { keepDefaultValues: true })
    schedule()
  }, [key, initialDraft, form, exclude, schedule])

  const discard = React.useCallback(() => {
    if (!key) return

    removeDraftRaw(key)
    setDecidedKey(key)
    // O que já foi digitado enquanto o aviso estava aberto passa a ser o rascunho.
    schedule()
  }, [key, schedule])

  const clear = React.useCallback(() => {
    cancelTimer()
    if (!key) return

    removeDraftRaw(key)
    setDecidedKey(key)
    clearedRef.current = sanitizeDraftValues(form.getValues(), { exclude })
  }, [cancelTimer, key, form, exclude])

  const offer = React.useMemo<FormDraftOffer | null>(
    () =>
      pendingDraft
        ? {
            savedAt: pendingDraft.savedAt,
            savedAtLabel: formatFormDraftSavedAt(pendingDraft.savedAt),
          }
        : null,
    [pendingDraft]
  )

  return { offer, restore, discard, clear, saveNow: persist }
}
