// Tamanhos de arquivo em pt-BR para textos discretos ("2,8 MB → 240 KB").

const KB = 1024
const MB = 1024 * KB

function number(value: number, fractionDigits: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })
}

export function formatBytes(bytes: number) {
  const value = Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0))
  if (value < KB) return `${value} B`
  if (value < MB) {
    const kilobytes = value / KB
    return `${number(kilobytes, kilobytes < 10 ? 1 : 0)} KB`
  }
  return `${number(value / MB, 1)} MB`
}

/** "2,8 MB → 240 KB" */
export function formatSizeChange(beforeBytes: number, afterBytes: number) {
  return `${formatBytes(beforeBytes)} → ${formatBytes(afterBytes)}`
}
