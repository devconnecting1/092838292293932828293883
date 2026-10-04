import {
  CalendarCheckIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  type LucideIcon,
} from "lucide-react"

import type { ActivityType } from "@/lib/clientes/constants"

export const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  note: StickyNoteIcon,
  call: PhoneIcon,
  email: MailIcon,
  whatsapp: MessageCircleIcon,
  visit: MapPinIcon,
  meeting: CalendarCheckIcon,
  status_change: RefreshCwIcon,
}
