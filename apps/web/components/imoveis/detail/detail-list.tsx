import { cn } from "@workspace/ui/lib/utils"

/** Lista de pares rótulo/valor da ficha (somente leitura). */
export function DetailList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3", className)} {...props} />
  )
}

export function DetailItem({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium wrap-break-word">{children}</dd>
    </div>
  )
}
