# Post Voice — Versionamento semântico automático e asset de release

**Data:** 2026-08-23
**Status:** Aprovado para planejamento de implementação

## Contexto

Hoje a versão do plugin é hardcoded em 3 lugares (`package.json`, header
`Version:` + constante `POST_VOICE_VERSION` em `post-voice.php`, `Stable tag:`
em `readme.txt`), atualizada manualmente, sem tags git e sem artefato de
release. Objetivo: a cada merge em `master`, calcular a próxima versão
semântica a partir dos commits (Conventional Commits, já em uso no projeto),
taggear, publicar uma GitHub Release e anexar o zip instalável do plugin —
sem passo manual.

## Decisões já fechadas (não reabrir sem motivo novo)

| Decisão | Escolha | Por quê |
|---|---|---|
| Ferramenta de versionamento | [semantic-release](https://semantic-release.gitbook.io/) | Zero-fricção: cada push em `master` já vira release, sem PR de release intermediário. Alternativa avaliada e descartada por ora: release-please (PR de release com checkpoint de revisão antes de taggear) — ver "Alternativa descartada" abaixo |
| CHANGELOG | Só GitHub Releases (notas geradas por `release-notes-generator`) | Sem `CHANGELOG.md` versionado no repo — evita um commit de bump a mais toda release |
| Distribuição | Só GitHub Release + zip | Sem deploy SVN para wordpress.org nesta spec — plugin ainda privado/não distribuído lá; deploy SVN fica para spec própria quando/se o plugin ganhar slug aprovado |
| Arquitetura | 2 workflows desacoplados | Motor de versão (`release.yml`) e build do asset (`release-assets.yml`) não se conhecem — trocar de ferramenta de versionamento no futuro (ex. migrar para release-please) toca só o primeiro |
| Gate de qualidade | `release.yml` só roda após `ci.yml` fechar verde em `master` | Push a `master` já dispara o `ci.yml` existente (lint/unit/php/i18n/e2e/audit); taggear antes disso arriscaria publicar código que o próprio CI reprova minutos depois |
| Token do Workflow A | PAT fine-grained (só este repo, `Contents: Read and write`), em secret `SEMANTIC_RELEASE_TOKEN` | `GITHUB_TOKEN` padrão não dispara outros workflows (trava de segurança do GitHub Actions contra loop) — se semantic-release criasse a release com ele, o evento `release: published` nunca chegaria em `release-assets.yml`, falha silenciosa. Workflow B não precisa de PAT: nada depende do que ele dispara depois |
| Tag inicial | Criar `v0.1.0` manualmente em `master` antes do primeiro run do Workflow A | semantic-release sem nenhuma tag prévia trata o repo como primeiro release e computa a partir de `1.0.0` do zero — ignoraria o `0.1.0` já hardcoded nos 3 arquivos e divergiria silenciosamente do que já existe |

### Alternativa descartada: release-please

Mantém um PR "release X.Y.Z" acumulando bump de versão + changelog a cada
push em `master`; só quando esse PR é mergeado manualmente é que a tag/release
sai de fato. Dá um checkpoint de revisão antes de qualquer coisa virar
pública — útil se quiser agrupar vários merges numa release só, editar o
changelog antes de publicar, ou ter uma rede de segurança contra um commit
classificado errado (`feat!` sem querer virando bump maior). Descartado agora
porque contradiz o requisito explícito de "toda vez que merge completar,
gerar versão" e o risco de release prematura é baixo (repo privado, plugin
ainda não distribuído). Migração para essa alternativa depois é barata — ver
"Custo de trocar de ferramenta depois".

## Arquitetura

Dois workflows GitHub Actions, desacoplados por evento:

```
merge → master
  └─ ci.yml (já existe) roda lint/unit/php/i18n/e2e/audit
       └─ conclusion == success
            └─ release.yml (workflow_run) ─ semantic-release
                 ├─ calcula versão (commit-analyzer)
                 ├─ bump nos 3 arquivos (exec)
                 ├─ commit `chore(release): X.Y.Z [skip ci]` (git)
                 └─ cria tag vX.Y.Z + GitHub Release (github)
                      └─ release: published
                           └─ release-assets.yml
                                ├─ checkout na tag, build de produção
                                ├─ zip respeitando .distignore
                                └─ gh release upload
```

`release.yml` dispara via `workflow_run: { workflows: ["CI"], types:
[completed], branches: [master] }` — `"CI"` é o **nome do workflow**
(campo `name:` no topo de `ci.yml`), não nome de job; o filtro
`branches: [master]` é necessário porque `ci.yml` também roda em
`pull_request` de qualquer branch, e só a execução pós-merge em `master`
deve poder gerar release. O job então checa
`github.event.workflow_run.conclusion == 'success'` antes de prosseguir —
nunca em resposta direta a `push`, para não correr em paralelo com o
próprio CI que ainda pode reprovar o commit.

`release-assets.yml` dispara em `release: types: [published]`, mais
`workflow_dispatch` (input `tag`) como reforço manual caso o build do zip
falhe e precise ser reprocessado sem recriar a release.

`concurrency: group: release-master, cancel-in-progress: false` em
`release.yml` — serializa releases que terminem de validar CI quase ao mesmo
tempo, sem cancelar um no meio.

## Workflow A — `release.yml`

Job com `permissions: contents: write`. Steps: checkout, `actions/setup-node@v4`,
`npm ci`, `npx semantic-release` com `env: GH_TOKEN:
${{ secrets.SEMANTIC_RELEASE_TOKEN }}` (o PAT fine-grained — ver tabela de
decisões; `GITHUB_TOKEN` padrão aqui faria o Workflow B nunca disparar).

Config em `.releaserc.json` com `plugins` **declarado explicitamente** (não
usa o set default do semantic-release, que inclui `@semantic-release/npm`
mesmo sem pedir — esse plugin, com `private:true`, não publica mas ainda
escreve `version` em `package.json` no seu `prepare`, duplicando/colidindo
com o `exec` do passo 3 abaixo tocando o mesmo arquivo). Preset
`conventionalcommits`, plugins em ordem:

1. **`@semantic-release/commit-analyzer`** — bump pelos commits desde a
   última tag: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:`/`!` →
   minor (não major — enquanto `major` for `0`, semver trata breaking como
   minor por padrão do semantic-release; virar major bump de verdade só
   depois que o projeto subir para `1.0.0` manualmente). Tipos
   `docs:`/`ci:`/`test:`/`chore:`/`refactor:`/`style:` sozinhos não geram
   release.
2. **`@semantic-release/release-notes-generator`** — monta as notas da
   GitHub Release a partir dos mesmos commits.
3. **`@semantic-release/exec`**, hook `prepare` — roda
   `node scripts/bump-plugin-version.mjs <nextRelease.version>`, que edita:
   - `package.json` (`version`)
   - `post-voice.php` (header `Version:` e a constante
     `POST_VOICE_VERSION`)
   - `readme.txt` (`Stable tag:`)

   Guardrail obrigatório: regex mira exatamente essas 3 linhas — nunca
   `Requires at least:`/`Requires PHP` em `post-voice.php`/`readme.txt`.
   Esses são pins de contrato que o CLAUDE.md proíbe mudar como efeito
   colateral de trabalho não relacionado.
4. **`@semantic-release/git`** — commita os 3 arquivos alterados direto em
   `master`: `chore(release): ${nextRelease.version} [skip ci]`. O
   `[skip ci]` impede esse próprio push de re-disparar `ci.yml` — e por
   consequência o `workflow_run` de `release.yml` — quebrando o possível
   loop.
5. **`@semantic-release/github`** — cria a tag `vX.Y.Z` e a GitHub Release
   com as notas geradas. Nenhum asset é anexado aqui; isso é
   responsabilidade do Workflow B.

Dependências novas em `devDependencies` (via `npm install --save-dev`,
passam pelos gates de audit existentes): `semantic-release`,
`@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`,
`@semantic-release/exec`, `@semantic-release/git`, `@semantic-release/github`,
`conventional-changelog-conventionalcommits`.

## Workflow B — `release-assets.yml`

Steps: checkout com `ref: ${{ github.event.release.tag_name }}`, setup
node, `npm ci`, `npm run build` (webpack gera `build/`, hoje gitignored —
precisa ser reconstruído aqui, não existe no commit), empacotamento
respeitando `.distignore` (novo arquivo, ver abaixo), depois
`gh release upload <tag> post-voice-X.Y.Z.zip`.

Empacotamento: copiar a árvore do checkout para um diretório limpo
`post-voice/` excluindo tudo que `.distignore` lista (`rsync -a
--exclude-from=.distignore . post-voice/` ou equivalente), depois
`zip -r post-voice-X.Y.Z.zip post-voice/`. `composer install` não é
necessário nesse workflow — `composer.json` só tem `require-dev`, não há
runtime dependency PHP para vendorizar.

### `.distignore` (novo arquivo)

Filosofia: só o que o WordPress precisa para rodar o plugin instalado.

**Mantém:** `post-voice.php`, `readme.txt`, `LICENSE`, `CREDITS.md`,
`languages/`, `build/` (saída compilada do webpack), `features/*/php`,
`shared/` (só a parte php).

**Exclui:** `node_modules/`, `vendor/`, `*/tests/` (dentro de cada feature),
`e2e/`, `docs/`, `.github/`, `.claude/`, `.superpowers/`, `coverage/`,
`artifacts/`, `test-results/`, `playwright-report/`, fontes TS não
compiladas (`features/*/editor`, `features/*/frontend`,
`features/*/admin` — só o `build/` compilado entra), `scripts/`,
`package.json`/`package-lock.json`, `composer.json`/`composer.lock`,
`webpack.config.js`, `tsconfig.json`, `phpstan.neon`, `phpcs.xml.dist`,
`phpunit.xml.dist`, `jest.config.js`, `playwright.config.ts`,
`.eslintrc.js`, `.prettierrc.js`, `.prettierignore`, `CLAUDE.md`,
`TESTING.md`, `.wp-env.json`, `types/`, `.git*`, `.husky/`, o próprio
`.distignore`.

## Erros e casos de borda

- **Lote só com commits não-releasable** (`docs:`/`ci:`/`test:` etc.):
  `commit-analyzer` não determina bump, `semantic-release` termina sem
  criar tag/release — comportamento padrão da ferramenta, não é falha.
- **`release-assets.yml` falha no build/zip**: a GitHub Release já existe
  (criada pelo Workflow A) mas sem asset anexado. Reprocessar via
  `workflow_dispatch` manual com o `tag` já existente, sem precisar recriar
  a release nem re-rodar `semantic-release`.
- **Dois merges concluindo CI quase ao mesmo tempo**: `concurrency` do
  Workflow A serializa — o segundo `release.yml` espera o primeiro
  terminar (commit de bump + tag) antes de calcular a versão seguinte a
  partir do estado atualizado de `master`.
- **Loop de push**: coberto pelo `[skip ci]` no commit de bump (item 4 do
  Workflow A) — sem esse marcador, o próprio commit de versionamento
  re-disparia `ci.yml` e, na conclusão, o `workflow_run` de `release.yml`.
- **PAT fine-grained expira**: tem validade máxima (renovação manual).
  Quando expirar, `release.yml` falha no passo de push/criação de release
  com erro de autenticação claro (não silencioso) — renovar o secret
  `SEMANTIC_RELEASE_TOKEN` resolve. Fora de escopo automatizar a
  renovação.

## Testing / verificação

- `npx semantic-release --dry-run` localmente antes de habilitar o
  workflow de fato, para conferir que o bump calculado bate com o
  esperado dado o histórico de commits.
- `release-assets.yml` testado via `workflow_dispatch` manual (apontando
  para uma tag/release existente) antes de depender só do evento
  `release.published` em produção.
- Merge de teste com um `fix:` trivial nesta própria branch, depois de
  mergeada, para validar o fluxo 0.1.0 → 0.1.1 fim-a-fim (tag, release,
  zip anexado, conteúdo do zip batendo com `.distignore`).

`scripts/bump-plugin-version.mjs` não ganha suite Jest: precedente já
estabelecido por `scripts/audit-check.mjs` e `scripts/audit-check-composer.mjs`
(scripts de tooling não cobertos por teste, fora do allowlist
`collectCoverageFrom` de `jest.config.js`, que lista arquivos de feature
individualmente). Verificação do script fica pelo dry-run e pelo merge de
teste acima — não é um ponto em aberto, é decisão consistente com o que já
existe no repo.

## Custo de trocar de ferramenta depois

Se o checkpoint de revisão (release-please) se tornar necessário mais
adiante: troca só o Workflow A. `.releaserc.json` sai,
`release-please-config.json` + `.release-please-manifest.json` entram
(bootstrap do manifest com a versão atual — manual, ~5min). Formato de tag
(`vX.Y.Z`) não muda, nenhuma tag antiga quebra. Workflow B, `.distignore` e
o script de bump não mudam — desacoplamento é o ponto central desta
arquitetura.

## Fora de escopo

- Deploy automático para o repositório SVN do wordpress.org.
- `CHANGELOG.md` versionado no repo.
- Qualquer canal de pré-release/beta (branch além de `master`).
