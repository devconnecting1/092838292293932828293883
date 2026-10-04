import { LandingPreviewSkeleton } from "@/components/marketing/landing-skeletons"

export default function LandingPreviewLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <LandingPreviewSkeleton />
    </div>
  )
}
