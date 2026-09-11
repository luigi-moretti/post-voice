# Contribuindo com o Post Voice

Obrigado pelo interesse. Este documento cobre o fluxo de contribuição —
para detalhes de cada gate (limiares de cobertura, timings, como rodar
uma suíte isolada), veja `TESTING.md`. Para as regras de arquitetura,
`CLAUDE.md` e `docs/adr/`.

## Fluxo: fork + pull request

Ninguém além do mantenedor tem push direto em `master`. O fluxo é:

1. Faça um fork deste repositório.
2. Clone o seu fork, crie uma branch a partir de `master`.
3. Implemente, com commits no padrão [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `chore:`, etc — veja `git log` para exemplos reais).
4. Rode o checklist completo abaixo antes de abrir o PR.
5. Push no seu fork, abra um Pull Request contra `master` deste repositório.
   O template de PR carrega automaticamente.
6. O CI roda sozinho no PR. Revisão humana acontece depois dos checks verdes.

## Setup local

```bash
git clone <seu-fork>
cd post-voice
npm ci                                   # nunca npm install — lockfile é a superfície de auditoria
composer install
npx playwright install --with-deps chromium chromium-headless-shell
npx wp-env start                         # WordPress em localhost:8888
```

Versões exigidas e o que cada comando cobre: `TESTING.md`.

## Loop de desenvolvimento

- **JS/editor**: `npm run start` (webpack em modo watch) recompila
  `build/` a cada save. wp-env já monta o repo direto no container — o
  build novo aparece depois de um refresh manual no navegador.
- **PHP**: **não tem watch.** Editar um `.php` e salvar não é suficiente —
  Docker Desktop cacheia por inode e o opcache mantém a compilação antiga.
  Depois de editar PHP, rode sempre:
  ```bash
  npm run refresh:php
  ```
  antes de testar a mudança no navegador. Esquecer esse passo é o jeito
  mais comum de perder tempo achando que uma mudança "não funcionou".

## Checklist antes de abrir o PR

Mandatório, nesta ordem — mais barato primeiro, falha rápido. `wp-env`
precisa estar rodando (`npx wp-env start`):

```bash
npm run lint:js && npm run lint:arch
npx tsc --noEmit
composer run lint && composer run stan
npm run test:unit -- --coverage
npm run test:php && npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e    # baixa o modelo na primeira vez
npm run doctor
```

O `.github/PULL_REQUEST_TEMPLATE.md` repete essa lista como checklist do
PR — marque cada item depois de rodar, não antes. Se algo falhar, corrija
antes de abrir o PR: um PR vermelho custa mais tempo de review do que
rodar isso localmente primeiro.

## Contribuição assistida por IA

Bem-vinda, com uma condição: você é responsável pelo conteúdo do PR
independente de quem/o que escreveu, e o template de PR pede pra declarar
a ferramenta usada. Revise a saída da IA como revisaria a sua própria —
ela passa pelos mesmos gates e pela mesma revisão humana.

## Dúvidas

Abra uma issue com o template "Question" antes de perguntar dentro de um
PR já aberto — mantém a thread do PR focada no código.
