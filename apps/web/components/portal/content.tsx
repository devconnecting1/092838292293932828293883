import Link from "next/link"

export function PageHero({
  kicker,
  title,
  text,
  children,
}: {
  kicker?: string
  title: string
  text?: string
  children?: React.ReactNode
}) {
  return (
    <section className="bg-[var(--brand-soft)]">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 py-14 sm:px-6">
        {kicker ? (
          <span className="self-start rounded-full bg-white px-3 py-1.5 text-sm font-bold text-[var(--brand-deep)]">
            {kicker}
          </span>
        ) : null}
        <h1 className="text-4xl leading-[1.08] font-extrabold tracking-tight sm:text-[44px]">
          {title}
        </h1>
        {text ? <p className="max-w-3xl text-lg leading-relaxed text-slate-700">{text}</p> : null}
        {children}
      </div>
    </section>
  )
}

export function Steps({ items }: { items: { t: string; d: string }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((s, i) => (
        <li key={s.t} className="flex items-start gap-4 rounded-2xl border border-slate-200 p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] font-extrabold text-white">
            {i + 1}
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-lg font-extrabold">{s.t}</span>
            <span className="leading-relaxed text-slate-600">{s.d}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function Section({
  id,
  title,
  children,
  muted,
}: {
  id?: string
  title: string
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <section id={id} className={muted ? "border-y border-slate-200 bg-slate-50" : ""}>
      <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 py-12 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">{title}</h2>
        {children}
      </div>
    </section>
  )
}

export function CtaBand({
  title,
  text,
  href,
  label,
}: {
  title: string
  text: string
  href: string
  label: string
}) {
  const external = href.startsWith("http") || href.startsWith("tel:")
  const cls = "rounded-xl bg-white px-6 py-4 font-extrabold text-[var(--brand-deep)]"
  return (
    <section className="mx-auto max-w-[960px] px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-[var(--brand-deep)] p-8 text-white sm:p-10">
        <div className="max-w-xl">
          <h2 className="text-2xl leading-tight font-extrabold">{title}</h2>
          <p className="mt-2 leading-relaxed opacity-90">{text}</p>
        </div>
        {external ? (
          <a href={href} className={cls}>
            {label}
          </a>
        ) : (
          <Link href={href} className={cls}>
            {label}
          </Link>
        )}
      </div>
    </section>
  )
}
