import { CircleAlertIcon, MailCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

export type FormFeedbackState =
  | { type: "error"; message: string; title?: string }
  | { type: "success"; message: string; title?: string }
  | null

export function FormFeedback({ feedback }: { feedback: FormFeedbackState }) {
  if (!feedback) {
    return null
  }

  if (feedback.type === "error") {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{feedback.title ?? "Não foi possível continuar"}</AlertTitle>
        <AlertDescription>{feedback.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="success">
      <MailCheckIcon />
      <AlertTitle>{feedback.title ?? "Verifique seu e-mail"}</AlertTitle>
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>
  )
}
