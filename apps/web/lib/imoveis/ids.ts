import { z } from "zod"

const uuidSchema = z.guid()

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidSchema.safeParse(value).success
}
