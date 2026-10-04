// Acesso ao localStorage para rascunhos. Tudo em try/catch: o storage pode não
// existir (servidor), estar bloqueado (modo privado, política do navegador) ou
// sem cota. Falhar aqui nunca pode quebrar o formulário.

import { isFormDraftKey, listStaleFormDraftKeys } from "@workspace/core/forms/draft"

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function readDraftRaw(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Grava o rascunho; false se o navegador recusar (cota, modo privado). */
export function writeDraftRaw(key: string, value: string): boolean {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeDraftRaw(key: string): void {
  try {
    getStorage()?.removeItem(key)
  } catch {
    // Sem storage não há o que apagar.
  }
}

let sweptThisPage = false

/**
 * Apaga rascunhos vencidos (de qualquer usuário deste navegador), uma vez por
 * carregamento de página: dado pessoal não fica guardado além dos 7 dias.
 */
export function sweepStaleDrafts(now: Date = new Date()): void {
  if (sweptThisPage) return
  sweptThisPage = true

  try {
    const storage = getStorage()
    if (!storage) return

    const entries: [string, string | null][] = []

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && isFormDraftKey(key)) entries.push([key, storage.getItem(key)])
    }

    for (const key of listStaleFormDraftKeys(entries, now)) {
      storage.removeItem(key)
    }
  } catch {
    // Limpeza é oportunista: tenta de novo no próximo carregamento.
  }
}
