import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

function HeadingSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {withAction ? <Skeleton className="h-8 w-40" /> : null}
    </div>
  )
}

/** Lista de landing pages. */
export function LandingListSkeleton() {
  return (
    <PageShell aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <HeadingSkeleton withAction />
      <Skeleton className="h-8 w-56" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </PageShell>
  )
}

/** Galeria de modelos. */
export function TemplateGallerySkeleton() {
  return (
    <PageShell aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <HeadingSkeleton withAction />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="flex flex-col gap-10">
        {Array.from({ length: 2 }, (_, group) => (
          <div key={group} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex flex-col gap-3">
                  <Skeleton className="aspect-4/3 w-full" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-8 w-40" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  )
}

/** Editor em tela cheia: formulário à esquerda e prévia encostada na borda direita. */
export function LandingEditorSkeleton() {
  return (
    <PageShell bleed aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <div className="flex flex-col gap-3 px-4 lg:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <Skeleton className="mx-4 h-8 lg:hidden" />
      <div className="grid flex-1 gap-6 px-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:ps-6 lg:pe-0">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
        <Skeleton className="hidden min-h-[36rem] w-full lg:block lg:rounded-e-none" />
      </div>
    </PageShell>
  )
}

/** Pré-visualização em tela cheia. */
export function LandingPreviewSkeleton() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="h-9 w-full rounded-none" />
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-[28rem] w-full" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
}
