import { redirect } from "next/navigation"

import { LANDING_PAGES_PATH } from "@/lib/marketing/constants"

export default function MarketingPage() {
  redirect(LANDING_PAGES_PATH)
}
