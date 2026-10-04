export function getInitials(value: string | null | undefined, fallback = "?") {
  const words = (value ?? "").trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return fallback
  }

  const first = words[0]?.charAt(0) ?? ""
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : ""

  return `${first}${last}`.toUpperCase()
}

export function getFirstName(value: string | null | undefined) {
  return (value ?? "").trim().split(/\s+/)[0] ?? ""
}
