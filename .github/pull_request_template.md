## O que muda

<!-- Em uma ou duas frases, no idioma do projeto (pt-BR) e sem jargão. -->

## Por quê

<!-- O problema que isso resolve, ou a decisão do dono que pede a mudança. -->

## Como foi verificado

<!-- O que você rodou e o que viu: testes, typecheck, lint, tela no preview,
     teste SQL na nuvem. Diga também o que NÃO foi verificado. -->

- [ ] `npm run typecheck`, `npm run lint` e `npm run test`
- [ ] Tela conferida no preview (375 px e desktop) — ou não se aplica
- [ ] Teste SQL rodado na nuvem (termina em `raise exception`, desfaz tudo) — ou não se aplica

## Banco e ambiente

<!-- Marque só o que se aplica. -->

- [ ] Sem migração
- [ ] Migração nova, com o arquivo em `supabase/migrations/` igual ao aplicado e a linha no `supabase/README.md`
- [ ] Variável de ambiente nova (está no `.env.example`, no `turbo.json` e na Saúde do sistema)

## Risco e o que fazer se der errado

<!-- O que quebra se estiver errado e como voltar atrás. -->
