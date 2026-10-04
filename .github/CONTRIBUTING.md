# Como entregar mudanças

A branch `main` é a que está em produção: todo push nela vai para o ar na Vercel e as migrações já aplicadas no Supabase precisam estar commitadas.

## Fluxo

1. Crie uma branch a partir da `main` (`git switch -c tipo/assunto`).
2. Faça a mudança e rode, antes do commit, `npm run typecheck`, `npm run lint` e `npm run test`. O hook de pré-commit roda lint, formatação e typecheck; nunca use `--no-verify`.
3. Abra o PR preenchendo o modelo. Descreva o que foi verificado e, principalmente, o que **não** foi.
4. Espere as verificações ficarem verdes:
   - **CI** — typecheck, lint, formatação, testes e build
   - **Banco** — aplica todas as migrações do zero num Supabase local e roda os testes SQL
   - **CodeQL** e **zizmor** — análise de código e dos workflows
   - **Supabase Preview** — confere que as migrações remotas estão no repositório
   - **Vercel** — deploy de pré-visualização do PR
5. Só então faça o merge na `main`.

## Regras que valem sempre

- **O repositório é público.** Nenhum segredo em arquivo: `.env*` fica fora do Git, e chave só entra por variável de ambiente na Vercel ou pelo Vault do Supabase.
- **Nunca use a chave `service_role`** no código do app.
- **Migração** aplicada no banco precisa do arquivo em `supabase/migrations/` com a mesma versão e de uma linha na tabela do `supabase/README.md`. Sem isso, a verificação "Supabase Preview" falha.
- **Data em teste SQL** usa `(now() at time zone 'America/Sao_Paulo')::date`, nunca `current_date`: o CI roda em UTC e o banco decide pelo dia de São Paulo.
- **Variável de ambiente nova** entra no `.env.example`, na lista do `turbo.json` e na Saúde do sistema do Console.
- **Dependências e actions** ficam na versão mais recente; actions são fixadas pelo SHA do commit, com a tag no comentário.

## Segurança

Falha de segurança não vira issue nem PR público: use o relato privado descrito em [SECURITY.md](./SECURITY.md).
