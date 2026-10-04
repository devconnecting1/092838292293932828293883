/** Atalhos da lista de imóveis. Arquivo puro: usado no servidor e no navegador. */

/** Id do campo de busca (o atalho `/` põe o foco nele). */
export const PROPERTY_SEARCH_INPUT_ID = "filtro-busca"

export const PROPERTY_LIST_SHORTCUTS = [
  { keys: "/", description: "Ir para a busca" },
  { keys: "N", description: "Cadastrar um imóvel" },
] as const

/**
 * Se a tecla deve ser ignorada porque a pessoa está escrevendo, usando um
 * atalho do navegador ou com uma janela modal aberta.
 */
export function shouldIgnoreShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
    return true
  }

  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  // Campo de texto, lista de opções aberta, menu, ou um gatilho que já usa
  // letras para navegar (o Select do Base UI pula para a opção pela inicial).
  const interactive =
    "input, textarea, select, [contenteditable='true'], [aria-haspopup], " +
    "[role='combobox'], [role='listbox'], [role='menu'], [role='menuitem'], " +
    "[role='option'], [role='dialog'], [role='alertdialog']"
  if (target.closest(interactive)) return true

  // Diálogo aberto em outro canto da tela (Base UI só monta o popup quando
  // abre): os atalhos da lista não devem roubar o teclado de dentro dele.
  return Boolean(
    target.ownerDocument.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]'
    )
  )
}
