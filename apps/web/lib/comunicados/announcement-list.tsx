"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/toast"

import { AnnouncementStrip } from "@/components/plataforma/comunicados/announcement-strip"
import { dismissPlatformAnnouncement } from "@/lib/comunicados/actions"
import type { ActiveAnnouncement } from "@/lib/comunicados/types"

/**
 * Faixas de comunicado no topo do CRM. Dispensar esconde na hora e grava no
 * banco (vale em qualquer aparelho); se a gravação falhar, a faixa volta.
 */
export function PlatformAnnouncementList({
  announcements,
}: {
  announcements: readonly ActiveAnnouncement[]
}) {
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(() => new Set())
  const [, startTransition] = React.useTransition()
  const visible = announcements.filter((announcement) => !hidden.has(announcement.id))

  if (visible.length === 0) {
    return null
  }

  function dismiss(id: string) {
    setHidden((current) => new Set(current).add(id))

    startTransition(async () => {
      const result = await dismissPlatformAnnouncement(id)

      if (!result.ok) {
        setHidden((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
        toast.add({ title: result.error, type: "error" })
      }
    })
  }

  return (
    <section
      aria-label="Comunicados da plataforma"
      className="flex flex-col gap-2 px-4 pt-4 lg:px-6"
    >
      {visible.map((announcement) => (
        <AnnouncementStrip
          key={announcement.id}
          announcement={announcement}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => dismiss(announcement.id)}
            >
              <XIcon />
              <span className="sr-only">Dispensar o comunicado {announcement.title}</span>
            </Button>
          }
        />
      ))}
    </section>
  )
}
