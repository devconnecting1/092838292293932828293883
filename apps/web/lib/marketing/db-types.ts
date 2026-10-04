import type { Tables, TablesInsert, TablesUpdate } from "@workspace/database/types"

/*
 * Tipos de `landing_pages` a partir dos tipos gerados (`@workspace/database/types`).
 *
 * Regras de gravação refletidas aqui (grants por coluna da migração):
 * - `created_by` é preenchido por trigger (auth.uid()); o app nunca envia nem lê;
 * - `published_at` é gravado pelo banco quando a página é publicada;
 * - `organization_id` vem sempre da sessão e não muda num UPDATE;
 * - `template` é fixo depois de criada a página;
 * - created_at/updated_at são gerados pelo banco.
 */

export type LandingPageRow = Tables<"landing_pages">

/** Colunas que o editor lê (sem created_by). */
export type LandingPageRecord = Omit<LandingPageRow, "created_by">

export type LandingPageInsert = Omit<
  TablesInsert<"landing_pages">,
  "created_by" | "published_at" | "created_at" | "updated_at"
>

export type LandingPageUpdate = Omit<
  TablesUpdate<"landing_pages">,
  | "created_by"
  | "published_at"
  | "id"
  | "created_at"
  | "updated_at"
  | "organization_id"
  | "template"
>
