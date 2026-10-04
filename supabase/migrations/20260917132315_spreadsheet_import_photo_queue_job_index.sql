-- =============================================================================
-- Importação de planilhas: índice da chave estrangeira da fila de fotos
-- =============================================================================
-- Performance Advisor (lint 0001_unindexed_foreign_keys): a FK
-- import_photo_queue_job_fkey (organization_id, job_id) não tinha índice que a
-- cobrisse. Exclusão de importação (cascata da imobiliária) e as consultas por
-- importação usam este índice.
create index if not exists import_photo_queue_organization_job_idx
  on private.import_photo_queue (organization_id, job_id);
