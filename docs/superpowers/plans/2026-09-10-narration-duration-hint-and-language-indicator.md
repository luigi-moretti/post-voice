# Narração — duração em minutos no hint de geração e indicador de idioma selecionado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar minutos (não só segundos) nas duas mensagens de duração do
painel de narração quando a estimativa passar de 60s, e mostrar visivelmente
qual idioma está marcado no toolbar inline de idioma do editor, mesmo com o
dropdown fechado.

**Architecture:** Duas mudanças independentes no mesmo feature
(`features/narration/editor`). (1) Um módulo novo, puro e testado em Jest
(`generation-time-hint.ts`), split de segundos em minutos+segundos e monta as
duas frases traduzidas; `index.tsx` só chama as funções nos dois call-sites
que hoje montam `sprintf` inline. (2) `inline-language-format.ts` passa a
usar a prop `text` do `ToolbarDropdownMenu` (texto visível ao lado do ícone,
distinta de `label`, que é só tooltip/a11y) para mostrar o nome do idioma
marcado; `label` vira dinâmico também, mesma lógica.

**Tech Stack:** TypeScript, React (`@wordpress/element`), `@wordpress/i18n`
(`__`/`sprintf`), `@wordpress/components` (`ToolbarDropdownMenu`), Jest
(`wp-scripts test-unit-js`).

**Spec:** `docs/superpowers/specs/2026-09-10-narration-duration-hint-and-language-indicator-design.md`

## Global Constraints

- Toda string visível ao autor passa por `__`/`sprintf` com o domínio
  `post-voice` (ADR-0010) — inclusive as duas frases novas.
- Nenhum import atravessa pra outra feature além dos cinco desvios já
  congelados em ADR-0005 — nada aqui cria um novo (ambos os arquivos tocados
  já são internos a `narration/editor`).
- Threshold de formato: `> 60` segundos estrito vira `Xm Ys`; `<= 60`
  permanece `Xs`. Mesma regra nos dois call-sites de `index.tsx`.
- Arredondamento de cada call-site é preservado como está hoje: `Math.ceil`
  no hint de "restante" durante geração, `Math.round` na mensagem de
  confirmação de texto longo — só o texto final muda, não a matemática de
  arredondamento.
- Sem cenário E2E novo (decisão do usuário, registrada na spec) — verificação
  do indicador de idioma é manual, documentada no PR.
- Sem mudança de interface pública (REST, meta de post, mensagens do worker),
  sem migração de dado, sem alteração de contrato (`MODEL_BASE_URL`, mínimos
  de WordPress/PHP).

---

## Task 1: `splitMinutesSeconds` — split puro de segundos em minutos+segundos

**Files:**
- Create: `features/narration/editor/generation-time-hint.ts`
- Test: `features/narration/tests/js/generation-time-hint.test.ts`
- Modify: `jest.config.js` (`collectCoverageFrom`)
- Modify: `TESTING.md` (lista de lógica pura coberta por Jest)

**Interfaces:**
- Produces: `splitMinutesSeconds(totalSeconds: number): { minutes: number; seconds: number }` — usada pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever o teste que falha**

Criar `features/narration/tests/js/generation-time-hint.test.ts`:

```ts
import { splitMinutesSeconds } from '../../editor/generation-time-hint';

describe( 'splitMinutesSeconds', () => {
	it( 'splits whole seconds into minutes and seconds', () => {
		expect( splitMinutesSeconds( 0 ) ).toEqual( { minutes: 0, seconds: 0 } );
		expect( splitMinutesSeconds( 59 ) ).toEqual( {
			minutes: 0,
			seconds: 59,
		} );
		expect( splitMinutesSeconds( 60 ) ).toEqual( { minutes: 1, seconds: 0 } );
		expect( splitMinutesSeconds( 61 ) ).toEqual( { minutes: 1, seconds: 1 } );
		expect( splitMinutesSeconds( 125 ) ).toEqual( {
			minutes: 2,
			seconds: 5,
		} );
	} );

	it( 'renders 0/0 for non-finite or negative input, same guard as formatTime', () => {
		expect( splitMinutesSeconds( Number.NaN ) ).toEqual( {
			minutes: 0,
			seconds: 0,
		} );
		expect( splitMinutesSeconds( Number.POSITIVE_INFINITY ) ).toEqual( {
			minutes: 0,
			seconds: 0,
		} );
		expect( splitMinutesSeconds( -1 ) ).toEqual( { minutes: 0, seconds: 0 } );
	} );
} );
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts`
Expected: FAIL — `Cannot find module '../../editor/generation-time-hint'`

- [ ] **Step 3: Implementação mínima**

Criar `features/narration/editor/generation-time-hint.ts`:

```ts
const MINUTE_THRESHOLD_SECONDS = 60;

/**
 * Split a whole number of seconds into minutes and the seconds left over, for
 * callers that word a "N minutes M seconds" sentence themselves — `formatTime`
 * in `../format-time` is the m:ss playback scrubber/countdown, a different
 * shape and a different pair of consumers (editor mini-player and the
 * frontend player), not this file's audience.
 *
 * Same non-finite/negative guard as `formatTime`: `NaN`/`Infinity`/negative
 * input yields `{ minutes: 0, seconds: 0 }` rather than leaking `NaN`/`-1`
 * into a sentence.
 *
 * @param totalSeconds Whole seconds, already rounded by the caller.
 */
export function splitMinutesSeconds( totalSeconds: number ): {
	minutes: number;
	seconds: number;
} {
	if ( ! Number.isFinite( totalSeconds ) || totalSeconds < 0 ) {
		return { minutes: 0, seconds: 0 };
	}
	const whole = Math.floor( totalSeconds );
	return { minutes: Math.floor( whole / 60 ), seconds: whole % 60 };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Registrar cobertura**

Em `jest.config.js`, dentro de `collectCoverageFrom`, adicionar a linha logo
depois de `'features/narration/editor/rtf-calibration.ts',`:

```js
		'features/narration/editor/rtf-calibration.ts',
		'features/narration/editor/generation-time-hint.ts',
```

Em `TESTING.md`, na frase que lista o que o Jest mede (linha ~48-54, "Only
pure functions are measured: ..."), adicionar a nova unidade ao final da
lista, antes do ponto final:

```
... the text sanitized ahead of the tokenizer (`tokenizer-sanitize.ts`), and
the minutes/seconds split behind the generation-time hints
(`generation-time-hint.ts`). The list lives in `jest.config.js` under
`collectCoverageFrom`.
```

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/generation-time-hint.ts \
        features/narration/tests/js/generation-time-hint.test.ts \
        jest.config.js TESTING.md
git commit -m "feat(narration): add splitMinutesSeconds for duration hints"
```

---

## Task 2: `formatRemainingHint` — frase do hint "restante" durante geração

**Files:**
- Modify: `features/narration/editor/generation-time-hint.ts`
- Test: `features/narration/tests/js/generation-time-hint.test.ts`

**Interfaces:**
- Consumes: `splitMinutesSeconds` (Task 1).
- Produces: `formatRemainingHint(wholeSeconds: number): string` — usada pela Task 4.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `generation-time-hint.test.ts`:

```ts
import { formatRemainingHint } from '../../editor/generation-time-hint';

describe( 'formatRemainingHint', () => {
	it( 'stays seconds-only at and below the one-minute threshold', () => {
		expect( formatRemainingHint( 9 ) ).toBe( '~9s remaining' );
		expect( formatRemainingHint( 60 ) ).toBe( '~60s remaining' );
	} );

	it( 'switches to minutes+seconds above the threshold', () => {
		expect( formatRemainingHint( 61 ) ).toBe( '~1m 1s remaining' );
		expect( formatRemainingHint( 316 ) ).toBe( '~5m 16s remaining' );
	} );
} );
```

(O import de `formatRemainingHint` junta com o import já existente de
`splitMinutesSeconds` no topo do arquivo — uma linha `import { ... } from
'../../editor/generation-time-hint';` só.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts`
Expected: FAIL — `formatRemainingHint is not a function`

- [ ] **Step 3: Implementação mínima**

Adicionar a `generation-time-hint.ts` (precisa do import de `@wordpress/i18n`
no topo do arquivo, que ainda não existe — adicionar `import { __, sprintf }
from '@wordpress/i18n';`):

```ts
import { __, sprintf } from '@wordpress/i18n';

/**
 * "~Ns remaining" during generation, becoming "~Nm Ns remaining" once the
 * estimate passes a minute — plain seconds reads as noise past that point.
 *
 * @param wholeSeconds Remaining seconds, already `Math.ceil`'d by the caller
 *                      (`index.tsx`), so this stays in step with the
 *                      countdown ticking down rather than skipping a second
 *                      early.
 */
export function formatRemainingHint( wholeSeconds: number ): string {
	if ( wholeSeconds > MINUTE_THRESHOLD_SECONDS ) {
		const { minutes, seconds } = splitMinutesSeconds( wholeSeconds );
		return sprintf(
			/* translators: 1: minutes remaining; 2: seconds remaining. */
			__( '~%1$dm %2$ds remaining', 'post-voice' ),
			minutes,
			seconds
		);
	}
	return sprintf(
		/* translators: %d: seconds remaining until narration is ready. */
		__( '~%ds remaining', 'post-voice' ),
		wholeSeconds
	);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts`
Expected: PASS (5 testes no total, os 3 de `splitMinutesSeconds` + os 2 novos)

- [ ] **Step 5: Commit**

```bash
git add features/narration/editor/generation-time-hint.ts \
        features/narration/tests/js/generation-time-hint.test.ts
git commit -m "feat(narration): add formatRemainingHint with minute formatting"
```

---

## Task 3: `formatEstimatedTimeMessage` — frase da confirmação de texto longo

**Files:**
- Modify: `features/narration/editor/generation-time-hint.ts`
- Test: `features/narration/tests/js/generation-time-hint.test.ts`

**Interfaces:**
- Consumes: `splitMinutesSeconds` (Task 1).
- Produces: `formatEstimatedTimeMessage(wholeSeconds: number): string` — usada pela Task 4.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `generation-time-hint.test.ts`:

```ts
import { formatEstimatedTimeMessage } from '../../editor/generation-time-hint';

describe( 'formatEstimatedTimeMessage', () => {
	it( 'stays seconds-only at and below the one-minute threshold', () => {
		expect( formatEstimatedTimeMessage( 60 ) ).toBe(
			'This text is long — estimated time: 60 seconds.'
		);
	} );

	it( 'switches to minutes+seconds above the threshold', () => {
		expect( formatEstimatedTimeMessage( 345 ) ).toBe(
			'This text is long — estimated time: 5m 45s.'
		);
	} );
} );
```

(Mesma nota da Task 2: o import junta com os de `splitMinutesSeconds` e
`formatRemainingHint` já presentes no topo do arquivo de teste.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts`
Expected: FAIL — `formatEstimatedTimeMessage is not a function`

- [ ] **Step 3: Implementação mínima**

Adicionar a `generation-time-hint.ts`:

```ts
/**
 * The long-text confirmation card's estimate. Same threshold and split as
 * `formatRemainingHint`, worded as its own sentence rather than sharing one:
 * the two cards read naturally in their own context, and translators see
 * full sentences, not fragments.
 *
 * Note: since `LONG_TEXT_CONFIRMATION_ETA_SECONDS` in `rtf-calibration.ts`
 * is 120, the card this feeds only ever renders with an ETA above 120 in
 * practice — the `<= 60` branch below is unreachable from that one call
 * site today. Kept anyway: this function is general-purpose, and coupling
 * its branching to a threshold defined in another module would be a trap
 * for whoever changes that threshold later.
 *
 * @param wholeSeconds Estimated seconds, already `Math.round`'d by the caller.
 */
export function formatEstimatedTimeMessage( wholeSeconds: number ): string {
	if ( wholeSeconds > MINUTE_THRESHOLD_SECONDS ) {
		const { minutes, seconds } = splitMinutesSeconds( wholeSeconds );
		return sprintf(
			/* translators: 1: estimated minutes; 2: estimated additional seconds. */
			__(
				'This text is long — estimated time: %1$dm %2$ds.',
				'post-voice'
			),
			minutes,
			seconds
		);
	}
	return sprintf(
		/* translators: %d: estimated generation time in seconds. */
		__( 'This text is long — estimated time: %d seconds.', 'post-voice' ),
		wholeSeconds
	);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts`
Expected: PASS (7 testes no total)

- [ ] **Step 5: Rodar cobertura do arquivo isolado**

Run: `npm run test:unit -- features/narration/tests/js/generation-time-hint.test.ts --coverage --collectCoverageFrom='features/narration/editor/generation-time-hint.ts'`
Expected: 100% lines/branches/functions — as três funções e os dois ramos de cada uma foram exercitados pelos testes acima.

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/generation-time-hint.ts \
        features/narration/tests/js/generation-time-hint.test.ts
git commit -m "feat(narration): add formatEstimatedTimeMessage with minute formatting"
```

---

## Task 4: Ligar as duas frases em `index.tsx`

**Files:**
- Modify: `features/narration/editor/index.tsx:16` (import), `:1210-1218` (hint de restante), `:1225-1236` (mensagem de confirmação)

**Interfaces:**
- Consumes: `formatRemainingHint`, `formatEstimatedTimeMessage` (Tasks 2 e 3).

- [ ] **Step 1: Adicionar o import**

Em `features/narration/editor/index.tsx`, logo depois do import de
`mp3-encoder` (linha 46: `import { encodeMp3 } from './mp3-encoder';`),
adicionar:

```tsx
import {
	formatRemainingHint,
	formatEstimatedTimeMessage,
} from './generation-time-hint';
```

- [ ] **Step 2: Trocar o hint de "restante"**

Localizar (dentro do bloco `isGenerating`, por volta da linha 1210):

```tsx
							{ remainingSeconds !== null && (
								<p className="post-voice-panel__hint">
									{ sprintf(
										/* translators: %d: seconds remaining until narration is ready. */
										__( '~%ds remaining', 'post-voice' ),
										Math.ceil( remainingSeconds )
									) }
								</p>
							) }
```

Trocar por:

```tsx
							{ remainingSeconds !== null && (
								<p className="post-voice-panel__hint">
									{ formatRemainingHint(
										Math.ceil( remainingSeconds )
									) }
								</p>
							) }
```

- [ ] **Step 3: Trocar a mensagem de confirmação de texto longo**

Localizar (dentro do bloco `state === 'confirming-long-text'`, por volta da
linha 1225):

```tsx
					{ state === 'confirming-long-text' && (
						<div className="post-voice-panel__card">
							<p>
								{ sprintf(
									/* translators: %d: estimated generation time in seconds. */
									__(
										'This text is long — estimated time: %d seconds.',
										'post-voice'
									),
									Math.round( etaSeconds ?? 0 )
								) }
							</p>
```

Trocar por:

```tsx
					{ state === 'confirming-long-text' && (
						<div className="post-voice-panel__card">
							<p>
								{ formatEstimatedTimeMessage(
									Math.round( etaSeconds ?? 0 )
								) }
							</p>
```

- [ ] **Step 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro novo.

- [ ] **Step 5: Rodar a suíte Jest inteira**

Run: `npm run test:unit`
Expected: PASS — nada quebrou (nenhum teste existente cobre `index.tsx`
diretamente, então isto confirma só que o resto da suíte continua verde).

- [ ] **Step 6: Commit**

```bash
git add features/narration/editor/index.tsx
git commit -m "feat(narration): show minutes in duration hints past 60 seconds"
```

---

## Task 5: Indicador de idioma selecionado no toolbar inline

**Files:**
- Modify: `features/narration/editor/inline-language-format.ts:8` (import), `:31-83` (função `Edit`)

**Interfaces:**
- Consumes: `LANGUAGE_LABELS` (já importado no arquivo, `./language-labels`).

- [ ] **Step 1: Adicionar `sprintf` ao import de i18n**

Trocar (linha 8):

```ts
import { __ } from '@wordpress/i18n';
```

Por:

```ts
import { __, sprintf } from '@wordpress/i18n';
```

- [ ] **Step 2: Calcular o rótulo do idioma atual**

Localizar (linha 45):

```ts
	const current = activeAttributes.language ?? '';
```

Adicionar logo abaixo:

```ts
	const currentLabel = current
		? ( LANGUAGE_LABELS[ current ] ?? current )
		: '';
```

- [ ] **Step 3: Passar `text` e tornar `label` dinâmico**

Localizar (linhas 70-82):

```ts
	return createElement(
		BlockControls,
		{ group: 'inline' },
		createElement(
			ToolbarGroup,
			null,
			createElement( ToolbarDropdownMenu, {
				icon: 'translation',
				label: __( 'Narrate in another language', 'post-voice' ),
				controls,
			} )
		)
	);
```

Trocar por:

```ts
	return createElement(
		BlockControls,
		{ group: 'inline' },
		createElement(
			ToolbarGroup,
			null,
			createElement( ToolbarDropdownMenu, {
				icon: 'translation',
				label: currentLabel
					? sprintf(
							/* translators: %s: currently selected narration language, e.g. "English". */
							__(
								'Narrate in another language (currently %s)',
								'post-voice'
							),
							currentLabel
					  )
					: __( 'Narrate in another language', 'post-voice' ),
				text: currentLabel || undefined,
				controls,
			} )
		)
	);
```

- [ ] **Step 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro novo.

- [ ] **Step 5: Checar lint (jsx-a11y/regras de i18n)**

Run: `npm run lint:js -- features/narration/editor/inline-language-format.ts`
Expected: sem erro novo.

- [ ] **Step 6: Verificação manual (registrar no PR)**

No wp-env (`npx wp-env start`), abrir um post, selecionar um trecho de texto,
abrir o dropdown de idioma no toolbar inline, marcar um idioma (ex.
"English"), fechar o dropdown e conferir que o nome do idioma aparece
visível ao lado do ícone no botão fechado — repetir com um segundo idioma
(ex. "Português") pra confirmar que `LANGUAGE_LABELS` é lido certo e que o
texto não estoura o layout do toolbar. Sem passo automatizado — decisão
registrada na spec (sem E2E novo).

- [ ] **Step 7: Commit**

```bash
git add features/narration/editor/inline-language-format.ts
git commit -m "feat(narration): show selected language on the inline toolbar button"
```

---

## Task 6: Gate completo antes do PR

**Files:** nenhum (só execução dos gates de `CLAUDE.md`/`TESTING.md`)

- [ ] **Step 1: Rodar a sequência completa de gates**

Com `npx wp-env start` já rodando:

```bash
npm run lint:js && npm run lint:arch
npx tsc --noEmit
composer run lint && composer run stan
npm run test:unit -- --coverage
npm run test:php && npm run test:php:coverage
npm run i18n:check
npm run audit:npm:production && npm run audit:npm && npm run audit:composer
npm run build && npm run test:e2e
```

Expected: tudo verde. `npm run i18n:check` deve acusar as 4 novas strings
traduzíveis (`~%1$dm %2$ds remaining`, `This text is long — estimated time:
%1$dm %2$ds.`, `Narrate in another language (currently %s)`) faltando no
`.pot` — rodar o gerador do `.pot` (ver `TESTING.md`, seção i18n) antes de
checar de novo, se o gate falhar por isso.

- [ ] **Step 2: Se tudo passar, `npm run doctor`**

Run: `npm run doctor`
Agir sobre o que ele reportar.

- [ ] **Step 3: `superpowers:requesting-code-review`**

Invocar a skill contra o diff da branch. Endereçar achados (ou justificar por
que não se aplicam) antes de abrir o PR.

- [ ] **Step 4: Commit final, se sobrar algum ajuste dos passos acima**

```bash
git add -A
git commit -m "chore(narration): address gate/review findings"
```

(Só se houver ajuste — se os passos 1-3 não geraram mudança, não há o que
commitar aqui.)

---

## Self-Review

**Cobertura da spec:** os 4 pontos da tabela de Decisão da spec
(threshold/arredondamento, rejeição do Intl — já decidido, sem tarefa de
código —, onde a lógica mora, mecanismo do indicador de idioma, label
dinâmico, sem E2E novo, CSS sem mudança) estão cobertos pelas Tasks 1-5; a
tabela de Mudanças da spec bate 1:1 com os arquivos tocados nas Tasks
1, 4 e 5, mais o `jest.config.js`/`TESTING.md` da Task 1.

**Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo de
código tem o código completo, não uma referência a "igual a task N".

**Consistência de tipos:** `splitMinutesSeconds` (Task 1) devolve `{ minutes:
number; seconds: number }`, consumida igual nas Tasks 2 e 3.
`formatRemainingHint`/`formatEstimatedTimeMessage` (Tasks 2 e 3) devolvem
`string`, mesma assinatura usada na Task 4. Nomes batem em todas as
ocorrências (`generation-time-hint.ts`, testes e `index.tsx`).
