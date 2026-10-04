/**
 * Ritmo da atualização automática da página de status, sem React nem DOM
 * (o ambiente entra por parâmetro, o que permite testar com relógio falso).
 *
 * Regras (custo zero na Vercel Hobby: nada de busca que ninguém vê):
 * - busca a cada `intervalMs` só com a aba visível;
 * - aba oculta: cancela o timer e a busca em andamento; ao voltar, busca logo
 *   se o último retrato já passou do intervalo;
 * - sem interação por `idlePauseMs`: pausa; qualquer interação retoma;
 * - uma busca por vez (a anterior é cancelada).
 */

export const STATUS_REFRESH_INTERVAL_MS = 60_000
export const STATUS_IDLE_PAUSE_MS = 30 * 60_000
const MIN_DELAY_MS = 1_000

export type StatusPollerEnvironment = {
  now(): number
  isVisible(): boolean
  setTimer(callback: () => void, delay: number): unknown
  clearTimer(handle: unknown): void
  /** Registra interação do usuário; devolve a função que remove os ouvintes. */
  onActivity(listener: () => void): () => void
  onVisibilityChange(listener: () => void): () => void
}

export type StatusPollerOptions = {
  env: StatusPollerEnvironment
  /** Quando o retrato inicial foi gerado (ms); null sem retrato. */
  initialGeneratedAt: number | null
  /** Faz uma busca; deve respeitar o sinal de cancelamento. */
  load(signal: AbortSignal): Promise<void>
  onPausedChange(paused: boolean): void
  intervalMs?: number
  idlePauseMs?: number
}

export type StatusPoller = {
  start(): void
  stop(): void
  refreshNow(): void
}

export function createStatusPoller({
  env,
  initialGeneratedAt,
  load,
  onPausedChange,
  intervalMs = STATUS_REFRESH_INTERVAL_MS,
  idlePauseMs = STATUS_IDLE_PAUSE_MS,
}: StatusPollerOptions): StatusPoller {
  let stopped = true
  let timer: unknown
  let controller: AbortController | null = null
  let paused = false
  let lastInteractionAt = env.now()
  // Retrato antigo (ISR ou aba restaurada) busca logo; recente espera o intervalo.
  let lastAttemptAt =
    initialGeneratedAt === null ? env.now() : Math.min(env.now(), initialGeneratedAt)
  let removeListeners: Array<() => void> = []

  function clear() {
    if (timer !== undefined) {
      env.clearTimer(timer)
      timer = undefined
    }
  }

  function setPaused(value: boolean) {
    if (paused !== value) {
      paused = value
      onPausedChange(value)
    }
  }

  function schedule() {
    clear()

    if (stopped || paused || !env.isVisible()) {
      return
    }

    const wait = intervalMs - (env.now() - lastAttemptAt)
    timer = env.setTimer(tick, Math.max(MIN_DELAY_MS, wait))
  }

  function fetchNow() {
    controller?.abort()
    const current = new AbortController()
    controller = current
    lastAttemptAt = env.now()

    void load(current.signal)
      .catch(() => {})
      .finally(() => {
        if (controller === current) {
          controller = null
          schedule()
        }
      })
  }

  function tick() {
    timer = undefined

    if (stopped || !env.isVisible()) {
      return
    }

    if (env.now() - lastInteractionAt >= idlePauseMs) {
      setPaused(true)
      return
    }

    fetchNow()
  }

  function onActivity() {
    lastInteractionAt = env.now()

    if (paused) {
      setPaused(false)
      schedule()
    }
  }

  function onVisibilityChange() {
    if (env.isVisible()) {
      onActivity()
      schedule()
      return
    }

    clear()
    controller?.abort()
    controller = null
  }

  return {
    start() {
      if (!stopped) {
        return
      }

      stopped = false
      removeListeners = [env.onActivity(onActivity), env.onVisibilityChange(onVisibilityChange)]
      schedule()
    },
    stop() {
      stopped = true
      clear()
      controller?.abort()
      controller = null

      for (const remove of removeListeners) {
        remove()
      }

      removeListeners = []
    },
    refreshNow() {
      if (stopped) {
        return
      }

      lastInteractionAt = env.now()
      setPaused(false)
      clear()
      fetchNow()
    },
  }
}
