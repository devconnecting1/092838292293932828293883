import { z } from "zod"

import type { Enums } from "@workspace/database/types"

import { isDateKey, isTimeKey } from "@/lib/agenda/datetime"

export const MEETING_POINT_MAX_LENGTH = 300
export const FEEDBACK_MAX_LENGTH = 5000

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "done",
  "no_show",
  "canceled",
] as const satisfies readonly Enums<"appointment_status">[]

export type AppointmentStatus = Enums<"appointment_status">

export const appointmentIdSchema = z.guid("Visita inválida.")

const entityOptionSchema = z.object({
  id: z.guid("Opção inválida."),
  label: z.string(),
  description: z.string().nullable(),
})

/**
 * Formulário de visita. Entrada e saída têm o mesmo tipo (sem transform), para
 * o react-hook-form e a Server Action usarem o mesmo schema.
 */
const appointmentShape = z.object({
  property: entityOptionSchema.nullable(),
  client: entityOptionSchema.nullable(),
  brokerId: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  meetingPoint: z
    .string()
    .trim()
    .max(
      MEETING_POINT_MAX_LENGTH,
      `O ponto de encontro pode ter no máximo ${MEETING_POINT_MAX_LENGTH} caracteres.`
    ),
})

type AppointmentShape = z.infer<typeof appointmentShape>

function refineAppointment<T extends AppointmentShape>(values: T, ctx: z.RefinementCtx<T>) {
  if (!values.property) {
    ctx.addIssue({
      code: "custom",
      path: ["property"],
      message: "Selecione o imóvel da visita.",
    })
  }

  if (!z.guid().safeParse(values.brokerId).success) {
    ctx.addIssue({
      code: "custom",
      path: ["brokerId"],
      message: "Selecione o corretor.",
    })
  }

  if (!isDateKey(values.date)) {
    ctx.addIssue({
      code: "custom",
      path: ["date"],
      message: "Informe a data da visita.",
    })
  }

  const validStart = isTimeKey(values.startTime)

  if (!validStart) {
    ctx.addIssue({
      code: "custom",
      path: ["startTime"],
      message: "Informe o horário de início.",
    })
  }

  if (!isTimeKey(values.endTime)) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "Informe o horário de término.",
    })
  } else if (validStart && values.endTime <= values.startTime) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "O término precisa ser depois do início.",
    })
  }
}

export const appointmentFormSchema = appointmentShape.superRefine(refineAppointment)

export type AppointmentFormValues = z.infer<typeof appointmentFormSchema>

/** Payload de `saveAppointment`: o formulário mais o id quando for edição. */
export const saveAppointmentSchema = appointmentShape
  .extend({ id: appointmentIdSchema.optional() })
  .superRefine(refineAppointment)

export type SaveAppointmentInput = z.infer<typeof saveAppointmentSchema>

const feedbackText = z
  .string()
  .trim()
  .max(FEEDBACK_MAX_LENGTH, `O retorno pode ter no máximo ${FEEDBACK_MAX_LENGTH} caracteres.`)

export const appointmentStatusUpdateSchema = z
  .object({
    id: appointmentIdSchema,
    status: z.enum(APPOINTMENT_STATUSES, "Status inválido."),
    rating: z.number().int().min(1).max(5).nullish(),
    feedback: feedbackText.nullish(),
  })
  .superRefine((values, ctx) => {
    if (values.status === "done" && values.rating == null) {
      ctx.addIssue({
        code: "custom",
        path: ["rating"],
        message: "Dê uma nota de 1 a 5 para a visita.",
      })
    }
  })

export type AppointmentStatusUpdateInput = z.infer<typeof appointmentStatusUpdateSchema>

/** Diálogo "Marcar como realizada": nota obrigatória (ToggleGroup usa string). */
export const appointmentFeedbackFormSchema = z.object({
  rating: z.string().regex(/^[1-5]$/, "Escolha uma nota de 1 a 5."),
  feedback: feedbackText,
})

export type AppointmentFeedbackFormValues = z.infer<typeof appointmentFeedbackFormSchema>
