# Topologia núcleo+extensões — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve seis das onze arestas cross-feature congeladas na ADR-0005
(1, 2, 6 de vez; 4, 5, 7-8-9 corrigidas/consolidadas) via injeção explícita de
dependência — nunca via filtro do WordPress — sem tocar no layout de pastas.

**Architecture:** Quatro mudanças de código independentes (DI em PHP pras
arestas 1/2, relocação de `ALLOWED_LANGUAGES`, relocação de `auth_callback`
pra `shared/`, porta consolidada no editor TS pras arestas 7-9), seguidas da
atualização de governança (ADR-0005's `desvios:`, ADR-0016 nova).

**Tech Stack:** PHP 8.2 (WordPress, PHPUnit/`WP_UnitTestCase`), TypeScript
(Jest, `@wordpress/scripts`), `scripts/lint-arch/` (Node, sem dependência
nova).

**Spec:** `docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md`
— o plano implementa exatamente o que lá está decidido; qualquer detalhe de
tipo/nome de arquivo abaixo que refine (não contradiga) o spec está resolvido
aqui porque o spec descreve o mecanismo, este plano é onde a decomposição em
arquivo vira final.

## Global Constraints

- Branch já existe: `docs/topologia-nucleo-extensoes-design`. Não criar outra.
- Nenhuma mudança em layout de pastas — `features/<f>/{php,editor,frontend,admin,tests}/`
  continua (ADR-0004), reafirmado no spec.
- Nenhum `interface` PHP novo — o codebase não usa a palavra-chave em lugar
  nenhum (confirmado por grep durante o brainstorming); a porta em PHP é um
  `callable` com assinatura em docblock, generalizando o idioma que a aresta 6
  (`auth_callback`) já usa.
- Nenhum filtro `apply_filters`/`add_filter`/`@wordpress/hooks` novo para
  resolver as arestas núcleo→satélite — é exatamente o que este trabalho
  evita (spec, "Decisões fechadas").
- `desvios:`/`status` da ADR-0005 só mudam na Task 5, e com a `key` copiada
  literalmente da saída de `npm run lint:arch` — nunca reconstruída de
  memória (regra da skill `adr`, seção 6).
- `npx wp-env start` precisa estar rodando antes de qualquer `npm run test:php`.
- Toda classe PHP nova segue `Post_Voice_<Nome>` em `class-<nome-kebab>.php`
  (ADR-0006): `Post_Voice_Model` → `class-model.php`,
  `Post_Voice_Capability_Guard` → `class-capability-guard.php`.

---

## Task 1: DI explícita em `Post_Voice_Assets` (arestas 1 e 2)

**Files:**
- Modify: `features/narration/php/class-assets.php`
- Modify: `post-voice.php`
- Modify: `features/narration/tests/php/test-assets.php`

**Interfaces:**
- Produces: `Post_Voice_Assets::set_dictionary_provider( callable $provider ): void`
  (assinatura exigida do `$provider`: `(): array<{term,replacement,language}>`),
  `Post_Voice_Assets::set_style_provider( callable $provider ): void`
  (assinatura exigida: `(): string`).
- Consumes: nada de novo — `Post_Voice_Dictionary_Store::get_global()` e
  `Post_Voice_Style_Store::inline_css()` (já existentes) passam a ser
  referenciados só de dentro de `post-voice.php`, como callable-string.

- [ ] **Step 1: Escrever os dois testes que falham (o setter ainda não existe)**

Adicionar em `features/narration/tests/php/test-assets.php`, antes de
`tear_down()`:

```php
	public function test_dictionary_provider_can_be_swapped_and_is_restored(): void {
		set_current_screen( 'post' );
		$this->with_asset_file( $this->asset_file() );

		$original = array( 'Post_Voice_Dictionary_Store', 'get_global' );
		Post_Voice_Assets::set_dictionary_provider(
			static function (): array {
				return array(
					array(
						'term'        => 'stub',
						'replacement' => 'STUB',
						'language'    => 'portuguese',
					),
				);
			}
		);

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'STUB', $data );

		Post_Voice_Assets::set_dictionary_provider( $original );
	}

	public function test_style_provider_can_be_swapped_and_is_restored(): void {
		$this->with_asset_file( $this->asset_file( 'player' ) );
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );
		$this->go_to( get_permalink( $post_id ) );

		$original = array( 'Post_Voice_Style_Store', 'inline_css' );
		Post_Voice_Assets::set_style_provider(
			static function (): string {
				return '.post-voice-player{--stub:1}';
			}
		);

		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertContains(
			'.post-voice-player{--stub:1}',
			(array) wp_styles()->get_data( 'post-voice-player', 'after' )
		);

		Post_Voice_Assets::set_style_provider( $original );
	}
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test:php -- --filter Test_Post_Voice_Assets`
Expected: FAIL — `Error: Call to undefined method Post_Voice_Assets::set_dictionary_provider()`

- [ ] **Step 3: Implementar os dois pontos de extensão em `class-assets.php`**

Adicionar, logo depois de `class Post_Voice_Assets {`, antes de `register()`:

```php
	/**
	 * Injetado por post-voice.php no boot. Assinatura exigida:
	 * `(): array<{term,replacement,language}>`.
	 *
	 * Callable, não `interface` — o projeto não declara `interface` em lugar
	 * nenhum (ADR-0006 só nomeia `class`), e isto generaliza o idioma que
	 * `auth_callback` já usa como callable-string. Ver
	 * docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
	 * "Mecanismo 1".
	 *
	 * @var callable|null
	 */
	private static $dictionary_provider;

	/**
	 * Injetado por post-voice.php no boot. Assinatura exigida: `(): string`.
	 *
	 * @var callable|null
	 */
	private static $style_provider;

	/**
	 * Fonte do dicionário global localizado no editor. Sem valor padrão: se
	 * `post-voice.php` esquecer de chamar isto, `call_user_func( null )`
	 * lança `TypeError` no primeiro enqueue — falha alta e imediata, a mesma
	 * classe de falha que remover `pronunciation/` sem atualizar este
	 * arquivo já produz hoje. Não há guarda "se nulo, array vazio": isso
	 * reintroduziria a falha silenciosa que este mecanismo troca por DI
	 * explícita em vez de filtro do WordPress.
	 *
	 * @param callable $provider Retorna as entradas a localizar.
	 */
	public static function set_dictionary_provider( callable $provider ): void {
		self::$dictionary_provider = $provider;
	}

	/**
	 * Fonte do CSS inline do player no frontend. Mesma escolha de falha alta
	 * do provider acima.
	 *
	 * @param callable $provider Retorna o CSS inline, ou `''`.
	 */
	public static function set_style_provider( callable $provider ): void {
		self::$style_provider = $provider;
	}

```

Trocar a linha 64 (dentro de `enqueue_editor_assets()`):

```php
				'dictionary'       => Post_Voice_Dictionary_Store::get_global(),
```

por:

```php
				'dictionary'       => call_user_func( self::$dictionary_provider ),
```

Trocar a linha 119 (dentro de `enqueue_frontend_assets()`):

```php
		$inline = Post_Voice_Style_Store::inline_css();
```

por:

```php
		$inline = call_user_func( self::$style_provider );
```

- [ ] **Step 4: Wire em `post-voice.php`**

Em `post-voice.php`, trocar:

```php
Post_Voice_Attachment_Cleanup::register();
Post_Voice_Assets::register();
```

por:

```php
Post_Voice_Attachment_Cleanup::register();
// Único lugar do plugin que conhece as duas pontas: o núcleo (Assets) e as
// extensões que provêm seus dados. features/narration/php/class-assets.php
// não referencia mais Post_Voice_Dictionary_Store nem Post_Voice_Style_Store
// — ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
// "Mecanismo 1".
Post_Voice_Assets::set_dictionary_provider( array( 'Post_Voice_Dictionary_Store', 'get_global' ) );
Post_Voice_Assets::set_style_provider( array( 'Post_Voice_Style_Store', 'inline_css' ) );
Post_Voice_Assets::register();
```

- [ ] **Step 5: Rodar os testes novos e a suíte inteira de `Test_Post_Voice_Assets`**

Run: `npm run test:php -- --filter Test_Post_Voice_Assets`
Expected: PASS — todos os testes, os dois novos e os já existentes (que
continuam passando porque `post-voice.php` já wireia os providers reais no
boot do PHPUnit, antes de qualquer teste rodar).

- [ ] **Step 6: `composer run stan` sobre o arquivo tocado**

Run: `composer run stan`
Expected: PASS — `callable` é um tipo válido de PHPStan; `call_user_func`
sobre uma propriedade `callable|null` pode acusar "possibly null" dependendo
do nível configurado. Se acusar, adicionar
`// @phpstan-ignore-next-line` não é aceitável (mascara o caso real de
esquecer o wiring) — em vez disso, checar se `phpstan-wordpress` já entende
que `post-voice.php` roda antes; se não entender, é um falso positivo
aceito com anotação explicando o porquê (o guard intencional é o `TypeError`
em runtime, não uma checagem estática).

- [ ] **Step 7: Commit**

```bash
git add features/narration/php/class-assets.php post-voice.php features/narration/tests/php/test-assets.php
git commit -m "$(cat <<'EOF'
refactor(narration): DI explícita para dicionário e CSS do player (ADR-0005)

class-assets.php para de referenciar Post_Voice_Dictionary_Store e
Post_Voice_Style_Store diretamente. post-voice.php injeta os dois
callables no boot — único lugar do plugin que conhece as duas pontas.
Falha alta preservada: sem wiring, TypeError imediato, não degradação
silenciosa (a alternativa rejeitada, apply_filters, teria dado o
contrário).

Resolve as arestas 1 e 2 do inventário da ADR-0005 (desvios: atualizado
na Task 5 deste plano, depois que as quatro mudanças de código
estiverem feitas).

Spec: docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md
Claude-Session: https://claude.ai/code/session_01Q8Wrpnxmq3yLPVLWMsoNya
EOF
)"
```

---

## Task 2: `Post_Voice_Model` — relocar `ALLOWED_LANGUAGES` (arestas 4 e 5)

**Files:**
- Create: `features/narration/php/class-model.php`
- Create: `features/narration/tests/php/test-model.php`
- Modify: `features/narration/php/class-rest-api.php`
- Modify: `features/narration/php/class-post-meta.php`
- Modify: `features/pronunciation/php/class-dictionary-section.php`
- Modify: `features/pronunciation/php/class-dictionary-store.php`
- Modify: `post-voice.php`

**Interfaces:**
- Produces: `Post_Voice_Model::ALLOWED_LANGUAGES` (`array`, os cinco códigos
  de idioma). `Post_Voice_Model::ALLOWED_VOICES` fica em
  `Post_Voice_Rest_Api` — não faz parte desta relocação (o spec só move
  `ALLOWED_LANGUAGES`; `ALLOWED_VOICES` não tem aresta cross-feature apontada
  pra ele, então mexer seria fora de escopo).
- Consumes: nada novo.

- [ ] **Step 1: Escrever o teste que falha, para a classe que ainda não existe**

Criar `features/narration/tests/php/test-model.php`:

```php
<?php
/**
 * Tests for Post_Voice_Model.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Model
 */
class Test_Post_Voice_Model extends WP_UnitTestCase {

	public function test_allowed_languages_lists_the_five_bundle_languages(): void {
		$this->assertSame(
			array( 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' ),
			Post_Voice_Model::ALLOWED_LANGUAGES
		);
	}
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:php -- --filter Test_Post_Voice_Model`
Expected: FAIL — `Error: Class "Post_Voice_Model" not found`

- [ ] **Step 3: Criar `class-model.php`**

```php
<?php
/**
 * O que o bundle do modelo Pocket TTS suporta.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Dono do dado "quais idiomas o modelo aceita" — antes vivia em
 * Post_Voice_Rest_Api, uma classe de transporte HTTP, sem relação com o
 * significado do dado. Equivalente PHP de `SUPPORTED_LANGUAGES` em
 * `model-source.ts`, que já mora ao lado do pin `MODEL_BASE_URL`.
 *
 * Ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
 * "Mecanismo 2".
 */
class Post_Voice_Model {

	public const ALLOWED_LANGUAGES = array( 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:php -- --filter Test_Post_Voice_Model`
Expected: PASS

- [ ] **Step 5: Apontar os quatro consumidores pra `Post_Voice_Model`**

Em `features/narration/php/class-rest-api.php`, remover a linha:

```php
	public const ALLOWED_LANGUAGES = array( 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' );
```

e trocar as três ocorrências de `self::ALLOWED_LANGUAGES` (dentro da própria
classe, nos métodos de validação) por `Post_Voice_Model::ALLOWED_LANGUAGES`.

Em `features/narration/php/class-post-meta.php`, `sanitize_languages()`,
trocar as duas ocorrências de `Post_Voice_Rest_Api::ALLOWED_LANGUAGES` por
`Post_Voice_Model::ALLOWED_LANGUAGES`.

Em `features/pronunciation/php/class-dictionary-section.php:86`, trocar:

```php
		$languages = Post_Voice_Rest_Api::ALLOWED_LANGUAGES;
```

por:

```php
		$languages = Post_Voice_Model::ALLOWED_LANGUAGES;
```

Em `features/pronunciation/php/class-dictionary-store.php:57`, dentro de
`sanitize()`, trocar:

```php
			if ( ! in_array( $language, Post_Voice_Rest_Api::ALLOWED_LANGUAGES, true ) ) {
```

por:

```php
			if ( ! in_array( $language, Post_Voice_Model::ALLOWED_LANGUAGES, true ) ) {
```

e atualizar o comentário logo acima (linhas 50-55), que hoje diz "the
endpoint's ALLOWED_LANGUAGES", para "Post_Voice_Model's ALLOWED_LANGUAGES —
the server's single source for what a language may be".

- [ ] **Step 6: Adicionar o `require_once` em `post-voice.php`**

Trocar:

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-post-meta.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-rest-api.php';
```

por:

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-model.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-post-meta.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-rest-api.php';
```

(`class-model.php` antes de `class-post-meta.php` e `class-rest-api.php`,
que já a usam na primeira request.)

- [ ] **Step 7: Rodar toda a suíte PHP tocada**

Run: `npm run test:php -- --filter "Test_Post_Voice_Model|Test_Post_Voice_Rest_Api|Test_Post_Voice_Post_Meta|Test_Post_Voice_Dictionary_Store|Test_Post_Voice_Dictionary_Section"`
Expected: PASS — nenhum teste existente referencia o símbolo pelo nome
(confirmado por grep durante o brainstorming: só usam strings literais como
`'portuguese'`), então nenhum teste precisa de edição além do novo arquivo.

- [ ] **Step 8: `composer run lint` e `composer run stan`**

Run: `composer run lint && composer run stan`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add features/narration/php/class-model.php features/narration/tests/php/test-model.php features/narration/php/class-rest-api.php features/narration/php/class-post-meta.php features/pronunciation/php/class-dictionary-section.php features/pronunciation/php/class-dictionary-store.php post-voice.php
git commit -m "$(cat <<'EOF'
refactor(narration): move ALLOWED_LANGUAGES para Post_Voice_Model (ADR-0005)

Post_Voice_Rest_Api era uma classe de transporte HTTP guardando um
dado de domínio (quais idiomas o modelo Pocket TTS aceita).
Post_Voice_Model é o dono correto — equivalente PHP de
SUPPORTED_LANGUAGES em model-source.ts.

Não inverte direção nenhuma: pronunciation continua lendo narration
(satélite→núcleo, já a direção correta). Corrige só a posse. As
arestas 4 e 5 do inventário da ADR-0005 continuam existindo, com a
key renomeada (desvios: atualizado na Task 5 deste plano).

Spec: docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md
Claude-Session: https://claude.ai/code/session_01Q8Wrpnxmq3yLPVLWMsoNya
EOF
)"
```

---

## Task 3: `Post_Voice_Capability_Guard` em `shared/` — relocar `auth_callback` (aresta 6)

**Files:**
- Create: `shared/php/class-capability-guard.php`
- Create: `shared/tests/php/test-capability-guard.php`
- Modify: `features/narration/php/class-post-meta.php`
- Modify: `features/pronunciation/php/class-dictionary-store.php`
- Modify: `features/narration/tests/php/test-post-meta.php`
- Modify: `post-voice.php`

**Interfaces:**
- Produces: `Post_Voice_Capability_Guard::auth_callback( $allowed, $meta_key, $post_id ): bool`
  — mesma assinatura e mesmo corpo que `Post_Voice_Post_Meta::auth_callback`
  tinha.
- Consumes: nada novo.

- [ ] **Step 1: Escrever o teste que falha, migrado de `test-post-meta.php`**

Criar `shared/tests/php/test-capability-guard.php`:

```php
<?php
/**
 * Tests for Post_Voice_Capability_Guard.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Capability_Guard
 */
class Test_Post_Voice_Capability_Guard extends WP_UnitTestCase {

	public function test_auth_callback_requires_edit_post_capability(): void {
		$post_id = self::factory()->post->create();

		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->assertFalse( Post_Voice_Capability_Guard::auth_callback( true, '_narration_language', $post_id ) );

		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );
		$this->assertTrue( Post_Voice_Capability_Guard::auth_callback( true, '_narration_language', $post_id ) );
	}
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:php -- --filter Test_Post_Voice_Capability_Guard`
Expected: FAIL — `Error: Class "Post_Voice_Capability_Guard" not found`

- [ ] **Step 3: Criar `class-capability-guard.php`**

```php
<?php
/**
 * Checagem de capability genérica, compartilhada entre features.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * `current_user_can( 'edit_post', … )` não é lógica de narration — sempre
 * teve dois consumidores reais (Post_Voice_Post_Meta e
 * Post_Voice_Dictionary_Store), a regra que `shared/` já aplica em outro
 * lugar (`class-settings-page.php`). Antes vivia em Post_Voice_Post_Meta e
 * era referenciada de pronunciation por string-callable — a aresta 6 do
 * inventário da ADR-0005.
 *
 * Ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
 * "Mecanismo 3".
 */
class Post_Voice_Capability_Guard {

	/**
	 * Gate meta writes on the post's own edit capability.
	 *
	 * @param bool   $allowed  Whether the user can act on the meta (unused; recomputed here).
	 * @param string $meta_key Meta key being authorised (unused; every caller shares one rule).
	 * @param int    $post_id  Post the meta belongs to.
	 */
	public static function auth_callback( $allowed, $meta_key, $post_id ): bool {
		return current_user_can( 'edit_post', $post_id );
	}
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:php -- --filter Test_Post_Voice_Capability_Guard`
Expected: PASS

- [ ] **Step 5: Remover o método de `Post_Voice_Post_Meta` e apontar pro guard**

Em `features/narration/php/class-post-meta.php`, remover inteiro o método
`auth_callback()` (linhas 37-46, incluindo o docblock). Em `register()`,
trocar:

```php
			'auth_callback' => array( self::class, 'auth_callback' ),
```

por:

```php
			'auth_callback' => array( 'Post_Voice_Capability_Guard', 'auth_callback' ),
```

- [ ] **Step 6: Apontar `class-dictionary-store.php` pro guard**

Em `features/pronunciation/php/class-dictionary-store.php`, dentro de
`register()`, trocar:

```php
				'auth_callback'     => array( 'Post_Voice_Post_Meta', 'auth_callback' ),
```

por:

```php
				'auth_callback'     => array( 'Post_Voice_Capability_Guard', 'auth_callback' ),
```

- [ ] **Step 7: Remover o teste migrado de `test-post-meta.php`**

Em `features/narration/tests/php/test-post-meta.php`, remover o método
`test_auth_callback_requires_edit_post_capability()` (linhas 121-131) — ele
testava um método que não existe mais nesta classe; a cobertura equivalente
agora vive em `shared/tests/php/test-capability-guard.php`.

- [ ] **Step 8: Adicionar o `require_once` em `post-voice.php`**

Trocar:

```php
require_once POST_VOICE_PATH . 'features/narration/php/class-model.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-post-meta.php';
```

por:

```php
require_once POST_VOICE_PATH . 'shared/php/class-capability-guard.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-model.php';
require_once POST_VOICE_PATH . 'features/narration/php/class-post-meta.php';
```

(`class-capability-guard.php` antes de `class-post-meta.php` e de
`features/pronunciation/php/class-dictionary-store.php`, que já a
referenciam na primeira request.)

- [ ] **Step 9: Rodar toda a suíte PHP tocada**

Run: `npm run test:php -- --filter "Test_Post_Voice_Capability_Guard|Test_Post_Voice_Post_Meta|Test_Post_Voice_Dictionary_Store"`
Expected: PASS

- [ ] **Step 10: `composer run lint` e `composer run stan`**

Run: `composer run lint && composer run stan`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add shared/php/class-capability-guard.php shared/tests/php/test-capability-guard.php features/narration/php/class-post-meta.php features/pronunciation/php/class-dictionary-store.php features/narration/tests/php/test-post-meta.php post-voice.php
git commit -m "$(cat <<'EOF'
refactor(shared): move auth_callback para Post_Voice_Capability_Guard (ADR-0005)

current_user_can('edit_post', ...) não é lógica de narration — já
tinha dois consumidores reais (Post_Voice_Post_Meta e
Post_Voice_Dictionary_Store), a regra que shared/ já aplica em
class-settings-page.php. Resolve de vez a aresta 6 do inventário da
ADR-0005: shared/ nunca conta como aresta cross-feature
(feature-deps.js exclui donos.feature === 'shared').

Spec: docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md
Claude-Session: https://claude.ai/code/session_01Q8Wrpnxmq3yLPVLWMsoNya
EOF
)"
```

---

## Task 4: Porta consolidada no editor (arestas 7, 8 e 9)

**Files:**
- Create: `features/narration/editor/dictionary-extension.ts`
- Create: `features/narration/editor/dictionary-extension.test.ts`
- Create: `features/pronunciation/editor/register-narration-extension.ts`
- Create: `features/pronunciation/editor/register-narration-extension.test.ts`
- Modify: `features/narration/editor/index.tsx`
- Modify: `jest.config.js`

**Interfaces:**
- Produces (`dictionary-extension.ts`): `DictionaryEntryShape` (type, shape
  `{term: string, replacement: string, language: string}`),
  `DictionaryPanelSlotProps` (type), `DictionaryExtension` (type: `{ Panel,
  mergeDictionaries, applyDictionary }`), `registerDictionaryExtension(
  ext: DictionaryExtension ): void`, `getDictionaryExtension():
  DictionaryExtension` (lança se nada foi registrado ainda).
- Consumes (por `register-narration-extension.ts`): `DictionaryPanel` de
  `./dictionary-panel`, `mergeDictionaries` de `./dictionary-entry`,
  `applyDictionary` de `./apply-dictionary` — os três já existentes em
  `pronunciation`, sem mudança de assinatura.

- [ ] **Step 1: Escrever o teste que falha, para o módulo da porta**

Criar `features/narration/editor/dictionary-extension.test.ts`:

```ts
import {
	registerDictionaryExtension,
	getDictionaryExtension,
} from './dictionary-extension';

describe( 'dictionary-extension', () => {
	// A ordem destes dois testes importa: o módulo guarda um único registro
	// em escopo de módulo, e o primeiro teste depende de nada ter
	// registrado ainda neste processo Jest.
	it( 'lança quando nada foi registrado ainda', () => {
		expect( () => getDictionaryExtension() ).toThrow(
			/no DictionaryExtension registered/
		);
	} );

	it( 'devolve exatamente o que foi registrado', () => {
		const Panel = () => null;
		const mergeDictionaries = (
			global: ReturnType< typeof Array >,
			post: ReturnType< typeof Array >
		) => [ ...global, ...post ];
		const applyDictionary = ( text: string ) => text;

		registerDictionaryExtension( { Panel, mergeDictionaries, applyDictionary } );

		expect( getDictionaryExtension() ).toEqual( {
			Panel,
			mergeDictionaries,
			applyDictionary,
		} );
	} );
} );
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- features/narration/editor/dictionary-extension.test.ts`
Expected: FAIL — módulo `./dictionary-extension` não existe.

- [ ] **Step 3: Criar `dictionary-extension.ts`**

```ts
import type { ComponentType } from 'react';

/**
 * O contrato mínimo que narration exige de uma entrada de dicionário —
 * declarado aqui, não importado de pronunciation. `DictionaryEntry` (em
 * pronunciation/editor/dictionary-entry.ts) tem a mesma forma; TypeScript
 * trata os dois como equivalentes por tipagem estrutural, sem precisar de
 * um import cross-feature aqui.
 */
export interface DictionaryEntryShape {
	term: string;
	replacement: string;
	language: string;
}

export interface DictionaryPanelSlotProps {
	entries: DictionaryEntryShape[];
	defaultLanguage: string;
	onChange: ( next: DictionaryEntryShape[] ) => void;
	settingsUrl: string | null;
}

/**
 * A porta que narration publica. pronunciation preenche via
 * `registerDictionaryExtension` — ver
 * features/pronunciation/editor/register-narration-extension.ts.
 */
export interface DictionaryExtension {
	Panel: ComponentType< DictionaryPanelSlotProps >;
	mergeDictionaries: (
		global: DictionaryEntryShape[],
		post: DictionaryEntryShape[]
	) => DictionaryEntryShape[];
	applyDictionary: (
		text: string,
		language: string,
		entries: DictionaryEntryShape[]
	) => string;
}

let extension: DictionaryExtension | null = null;

/**
 * Chamado uma vez pelo adaptador (pronunciation), como efeito colateral do
 * import. Ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
 * "Mecanismo 4".
 */
export function registerDictionaryExtension( ext: DictionaryExtension ): void {
	extension = ext;
}

/**
 * Acessor de narration. Lança em vez de degradar em silêncio — a mesma
 * escolha de falha alta feita para o wiring PHP em Post_Voice_Assets
 * (Task 1 deste plano).
 */
export function getDictionaryExtension(): DictionaryExtension {
	if ( ! extension ) {
		throw new Error(
			'post-voice: no DictionaryExtension registered — is ' +
				"'pronunciation/editor/register-narration-extension' imported before this runs?"
		);
	}
	return extension;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- features/narration/editor/dictionary-extension.test.ts`
Expected: PASS

- [ ] **Step 5: Escrever o teste que falha, para o adaptador**

Criar `features/pronunciation/editor/register-narration-extension.test.ts`:

```ts
import { getDictionaryExtension } from '../../narration/editor/dictionary-extension';
import { DictionaryPanel } from './dictionary-panel';
import { mergeDictionaries } from './dictionary-entry';
import { applyDictionary } from './apply-dictionary';
import './register-narration-extension';

describe( 'register-narration-extension', () => {
	it( "registra o Panel e as funções reais de pronunciation na porta de narration", () => {
		const ext = getDictionaryExtension();
		expect( ext.Panel ).toBe( DictionaryPanel );
		expect( ext.mergeDictionaries ).toBe( mergeDictionaries );
		expect( ext.applyDictionary ).toBe( applyDictionary );
	} );
} );
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `npm run test:unit -- features/pronunciation/editor/register-narration-extension.test.ts`
Expected: FAIL — módulo `./register-narration-extension` não existe.

- [ ] **Step 7: Criar `register-narration-extension.ts`**

```ts
import { registerDictionaryExtension } from '../../narration/editor/dictionary-extension';
import { DictionaryPanel } from './dictionary-panel';
import { mergeDictionaries } from './dictionary-entry';
import { applyDictionary } from './apply-dictionary';

// Efeito colateral do import: preenche a porta que narration publica.
// Único arquivo de pronunciation que narration precisa importar — ver
// Step 8 abaixo. Antes eram três imports nomeados de três módulos
// diferentes (arestas 7, 8 e 9 do inventário da ADR-0005); agora é este
// um import só.
registerDictionaryExtension( { Panel: DictionaryPanel, mergeDictionaries, applyDictionary } );
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npm run test:unit -- features/pronunciation/editor/register-narration-extension.test.ts`
Expected: PASS

- [ ] **Step 9: Atualizar `index.tsx` — imports**

Trocar:

```ts
import { DictionaryPanel } from '../../pronunciation/editor/dictionary-panel';
import type { DictionaryEntry } from '../../pronunciation/editor/dictionary-entry';
import { mergeDictionaries } from '../../pronunciation/editor/dictionary-entry';
import { applyDictionary } from '../../pronunciation/editor/apply-dictionary';
```

por:

```ts
import {
	getDictionaryExtension,
	type DictionaryEntryShape as DictionaryEntry,
} from './dictionary-extension';
// Efeito colateral: registra o Panel/mergeDictionaries/applyDictionary de
// pronunciation na porta acima, antes de qualquer render deste componente.
import '../../pronunciation/editor/register-narration-extension';
```

- [ ] **Step 10: Atualizar `index.tsx` — os dois call sites em `buildSegments`**

Dentro de `buildSegments` (por volta da linha 311-323), trocar:

```ts
			const dictionary = mergeDictionaries(
				window.postVoiceData?.dictionary ?? [],
				postDictionary
			);
			const resolved = mergeAdjacent( resolveSegments( raw, language ) );
			return resolved.map( ( segment ) => ( {
				...segment,
				text: applyDictionary(
					segment.text,
					segment.language,
					dictionary
				),
			} ) );
```

por:

```ts
			const dictionary = getDictionaryExtension().mergeDictionaries(
				window.postVoiceData?.dictionary ?? [],
				postDictionary
			);
			const resolved = mergeAdjacent( resolveSegments( raw, language ) );
			return resolved.map( ( segment ) => ( {
				...segment,
				text: getDictionaryExtension().applyDictionary(
					segment.text,
					segment.language,
					dictionary
				),
			} ) );
```

Chamar `getDictionaryExtension()` dentro do callback (não guardar numa
variável do escopo do componente) mantém `buildSegments` fora do escopo do
`react-hooks/exhaustive-deps` do jeito que `mergeDictionaries`/
`applyDictionary` importados já estavam — a lista de dependências do
`useCallback` (`[ blocks, language, postDictionary ]`) não muda.

- [ ] **Step 11: Atualizar `index.tsx` — o uso em JSX**

Logo antes de `return (` (por volta da linha 1121), adicionar:

```ts
	// Resolvido uma vez por render, só pro JSX abaixo — os dois usos dentro
	// de buildSegments (Step 10) chamam getDictionaryExtension() direto,
	// porque JSX não aceita uma chamada de função como nome de tag.
	const { Panel: DictionaryExtensionPanel } = getDictionaryExtension();

	return (
```

E, por volta da linha 1409, trocar:

```tsx
					<DictionaryPanel
						entries={ postDictionary }
						defaultLanguage={ language }
						onChange={ setPostDictionary }
						settingsUrl={
							window.postVoiceData?.canManageOptions
								? 'options-general.php?page=post-voice'
								: null
						}
					/>
```

por:

```tsx
					<DictionaryExtensionPanel
						entries={ postDictionary }
						defaultLanguage={ language }
						onChange={ setPostDictionary }
						settingsUrl={
							window.postVoiceData?.canManageOptions
								? 'options-general.php?page=post-voice'
								: null
						}
					/>
```

- [ ] **Step 12: Adicionar as duas portas ao allowlist de cobertura**

Em `jest.config.js`, `collectCoverageFrom`, adicionar duas linhas depois de
`'features/pronunciation/editor/row-ids.ts',`:

```js
		'features/narration/editor/dictionary-extension.ts',
		'features/pronunciation/editor/register-narration-extension.ts',
```

- [ ] **Step 13: `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: PASS. `DictionaryEntryShape` e `DictionaryEntry` (pronunciation)
têm forma idêntica (três campos `string`), então `DictionaryPanel` (tipado
com o `DictionaryEntry` de pronunciation) é atribuível a
`ComponentType< DictionaryPanelSlotProps >` por tipagem estrutural. Se o
compilador acusar, o ajuste é tipar `Panel` em `register-narration-extension.ts`
explicitamente como `ComponentType< DictionaryPanelSlotProps >` na chamada de
`registerDictionaryExtension`, não introduzir um `as any`.

- [ ] **Step 14: `npm run lint:js`**

Run: `npm run lint:js`
Expected: PASS

- [ ] **Step 15: Rodar os testes Jest tocados e a suíte completa de `narration`+`pronunciation`**

Run: `npm run test:unit -- features/narration/editor/dictionary-extension.test.ts features/pronunciation/editor/register-narration-extension.test.ts`
Expected: PASS

Run: `npm run test:unit`
Expected: PASS — inclui `dictionary-entry.test.ts` e `apply-dictionary.test.ts`,
que não mudam (as funções puras que testam não mudaram de assinatura).

- [ ] **Step 16: Commit**

```bash
git add features/narration/editor/dictionary-extension.ts features/narration/editor/dictionary-extension.test.ts features/pronunciation/editor/register-narration-extension.ts features/pronunciation/editor/register-narration-extension.test.ts features/narration/editor/index.tsx jest.config.js
git commit -m "$(cat <<'EOF'
refactor(narration): porta consolidada para a extensão de dicionário (ADR-0005)

index.tsx troca quatro símbolos nomeados de três módulos de
pronunciation por uma porta tipada (DictionaryExtension) que
pronunciation preenche via um único import de efeito colateral
(register-narration-extension.ts).

Limite físico reconhecido, não resolvido: index.tsx é o único entry
webpack, sem composition root em runtime JS acima dele — algo dentro
do bundle ainda precisa importar o módulo de registro. Consolida as
arestas 7, 8 e 9 do inventário da ADR-0005 numa só (key atualizada
na Task 5 deste plano); não as elimina.

Spec: docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md
Claude-Session: https://claude.ai/code/session_01Q8Wrpnxmq3yLPVLWMsoNya
EOF
)"
```

---

## Task 5: Editar `desvios:` da ADR-0005

**Files:**
- Modify: `docs/adr/0005-topologia-de-dependencia-entre-features.md`
- Modify: `scripts/lint-arch/tests/rule-feature-deps.test.js`
- Modify: `scripts/lint-arch/tests/rules-php-shape.test.js`

**Interfaces:**
- Consumes: a saída de `npm run lint:arch` deste ponto do branch (rodada
  depois das Tasks 1-4) — é dali que as `key`s exatas vêm, não deste plano.

**Nota adicionada durante a execução (Task 4):** além do front-matter da
ADR-0005, dois testes Jest em `scripts/lint-arch/tests/` afirmam fatos
literais sobre o estado *atual* do repo (não fixtures isoladas) — quantas
arestas cross-feature existem, e quantas classes PHP o repo tem. As Tasks
1-4 mudaram os dois números de verdade; sem atualizar esses dois arquivos,
`npm run test:unit` fica vermelho mesmo com todo o resto correto. Isto não
estava no plano original — ver `Task 4: Ruling` no ledger da execução.

- [ ] **Step 1: Rodar `lint:arch` e ler as chaves de dívida quitada**

Run: `npm run lint:arch`
Expected: sai **1** neste ponto, não 0 — correção feita durante a execução
(ver ledger da Task 4): o adaptador `register-narration-extension.ts`
(produção, criado na Task 4) importa `registerDictionaryExtension` de
`narration/editor/dictionary-extension`, uma aresta nova real que nenhum
`desvios:` lista ainda — `feature-deps` reprova até este Step 3 adicioná-la.
A seção de avisos lista como "dívida quitada" as chaves das arestas 1, 2 e 6
(resolvidas) e das arestas 4, 5 (a `key` antiga, que apontava pra
`Post_Voice_Rest_Api`) — porque o código já não as viola, mas a lista em
`desvios:` ainda cita a forma antiga. As arestas 7, 8, 9 também aparecem
quitadas nas suas chaves antigas, substituídas por uma nova. A saída também
lista, como `problems` (não `warnings`), a aresta nova do adaptador — copie
a `key` dali para o Step 3 junto com as outras.

- [ ] **Step 2: Rodar `npm run doctor` para conferir a lista de dívida congelada atual**

Run: `npm run doctor`
Expected: a seção "dívida congelada" mostra o estado real do repo — usar essa
saída, e a de `lint:arch`, para montar a lista nova de `desvios:` (nunca
digitar as `key`s de memória).

- [ ] **Step 3: Editar o front-matter de `docs/adr/0005-topologia-de-dependencia-entre-features.md`**

Trocar o bloco `desvios:` (11 entradas) por sete, usando as `key`s
copiadas literalmente da saída da Step 1/2 — o formato esperado, a confirmar
contra a saída real:

```yaml
desvios:
  - features/player-style/php/class-style-section.php → Post_Voice_Frontend_Render
  - features/pronunciation/php/class-dictionary-section.php → Post_Voice_Model
  - features/pronunciation/php/class-dictionary-store.php → Post_Voice_Model
  - features/narration/editor/index.tsx → pronunciation/editor/register-narration-extension
  - features/pronunciation/editor/register-narration-extension.ts → narration/editor/dictionary-extension
  - features/pronunciation/editor/dictionary-panel.tsx → narration/editor/model-source
  - features/pronunciation/editor/dictionary-entry.ts → narration/editor/model-source
```

A quinta entrada acima (`register-narration-extension.ts →
dictionary-extension`) é a aresta 12 descrita na correção da Task 4 no
ledger — satélite→núcleo (o adaptador de pronunciation importando a porta
que narration publica), mesma categoria de custo já aceito que as arestas
3/10/11 (sem indireção nova, sem filtro). Não existia entre as onze
originais porque `dictionary-extension.ts` não existia antes da Task 4.

`status` continua `aceita-com-desvio` (a lista não chegou a zero). Não tocar
`Contexto`, `Decisão`, `Consequências` nem `Alternativas rejeitadas` — são
campos imutáveis (ADR-0001).

- [ ] **Step 4: Atualizar o meta-teste de arestas em `scripts/lint-arch/tests/rule-feature-deps.test.js`**

No bloco `describe( 'o repo de hoje', ...)` no fim do arquivo, trocar:

```js
describe( 'o repo de hoje', () => {
	it( 'acha exatamente as onze arestas', () => {
		expect( regra.check( createContext() ) ).toHaveLength( 11 );
	} );

	it( 'as onze chaves batem, uma a uma, com desvios: da ADR-0005', () => {
		const achadas = regra
			.check( createContext() )
			.map( ( f ) => f.key )
			.sort();
		const listadas = loadAdrs( 'docs/adr' )
			.find( ( a ) => a.id === '0005' )
			.desvios.sort();
		expect( achadas ).toEqual( listadas );
	} );
} );
```

por:

```js
describe( 'o repo de hoje', () => {
	it( 'acha exatamente as sete arestas', () => {
		expect( regra.check( createContext() ) ).toHaveLength( 7 );
	} );

	it( 'as sete chaves batem, uma a uma, com desvios: da ADR-0005', () => {
		const achadas = regra
			.check( createContext() )
			.map( ( f ) => f.key )
			.sort();
		const listadas = loadAdrs( 'docs/adr' )
			.find( ( a ) => a.id === '0005' )
			.desvios.sort();
		expect( achadas ).toEqual( listadas );
	} );
} );
```

O segundo teste compara contra o `desvios:` que a Step 3 acabou de escrever
— se as duas listas não baterem depois desta troca, a `desvios:` da ADR ou
esta lista tem uma `key` errada; não prossiga sem entender qual das duas.

- [ ] **Step 5: Atualizar o meta-teste de classes em `scripts/lint-arch/tests/rules-php-shape.test.js`**

Trocar:

```js
	it( 'mapeia as 11 classes do repo', () => {
		expect( naming.phpClassOwners( createContext() ).size ).toBe( 11 );
	} );
```

por:

```js
	it( 'mapeia as 13 classes do repo', () => {
		expect( naming.phpClassOwners( createContext() ).size ).toBe( 13 );
	} );
```

(As duas classes novas das Tasks 2 e 3 — `Post_Voice_Model` e
`Post_Voice_Capability_Guard` — somam 11 + 2 = 13.)

- [ ] **Step 6: Rodar `npm run test:unit -- scripts/lint-arch/tests` e confirmar os dois arquivos verdes**

Run: `npm run test:unit -- scripts/lint-arch/tests`
Expected: PASS — os 13 test suites de `scripts/lint-arch/tests/`, incluindo
os dois editados nos Steps 4-5.

- [ ] **Step 7: Rodar `lint:arch` de novo e confirmar limpo**

Run: `npm run lint:arch`
Expected: sai 0, sem aviso de dívida quitada pendente e sem violação nova.

- [ ] **Step 8: Commit**

```bash
git add docs/adr/0005-topologia-de-dependencia-entre-features.md scripts/lint-arch/tests/rule-feature-deps.test.js scripts/lint-arch/tests/rules-php-shape.test.js
git commit -m "$(cat <<'EOF'
docs(adr): atualiza desvios: da ADR-0005 (11 → 7 arestas)

Reflete o código depois das Tasks 1-4: arestas 1, 2 e 6 resolvidas de
vez (saem da lista); 4 e 5 com a key renomeada (Post_Voice_Rest_Api →
Post_Voice_Model); 7, 8 e 9 consolidadas numa key só; mais uma aresta
nova (o adaptador de pronunciation importando a porta que narration
publica — satélite→núcleo, mesma categoria de custo já aceito que
3/10/11, descoberta durante a Task 4). status permanece
aceita-com-desvio — a lista não chegou a zero. Nenhum campo
imutável da ADR foi tocado.

Os dois meta-testes de scripts/lint-arch/tests/ que afirmam contagem
real do repo (arestas e classes PHP) atualizados junto — 11→7 e 11→13.

Spec: docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md
Claude-Session: https://claude.ai/code/session_01Q8Wrpnxmq3yLPVLWMsoNya
EOF
)"
```

---

## Task 6: ADR-0016 — o mecanismo como padrão do projeto

**Files:**
- Create: `docs/adr/0016-di-explicita-para-extensao-nucleo-satelite.md`
- Modify: `docs/adr/README.md`

**Interfaces:** nenhuma — documentação e governança, sem código.

- [ ] **Step 1: Criar a ADR-0016**

```markdown
---
id: 0016
titulo: Injeção explícita no bootstrap, não filtro do WordPress, para arestas núcleo→satélite
status: aceita
data: 2026-09-11
origem: superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md#mecanismo-1-di-explícita-para-arestas-1-e-2-php
enforced_by: [ review-manual ]
revisar_quando: uma aresta núcleo→satélite exigir narration rodando com a extensão desligada
desvios: []
---

## Contexto

A ADR-0005 mediu cinco arestas onde o núcleo (`narration`) lê uma extensão
(`pronunciation`, `player-style`) diretamente, e decidiu não inverter sem um
requisito real puxando. O `docs/research/2026-08-27-custo-inversao-arestas-cross-feature.md`
mediu duas famílias de mecanismo para quando alguém decidisse resolver: um
filtro do WordPress (`apply_filters`/`add_filter`, ou `@wordpress/hooks` do
lado TypeScript) e injeção de dependência explícita no bootstrap. As duas
resolvem a aresta; só uma foi escolhida, e a razão nunca tinha sido
registrada — a próxima aresta do mesmo tipo reabriria a mesma pergunta sem
achado nenhum pra consultar.

## Decisão

Quando o núcleo precisa de algo que só uma extensão provê, a extensão é
injetada explicitamente, nunca via registro global de string. Em PHP: um
`callable` guardado numa propriedade estática do núcleo, atribuído uma vez em
`post-voice.php` (`Post_Voice_Assets::set_dictionary_provider(...)`), nunca
`apply_filters`. Em TypeScript: um módulo de porta que o núcleo publica
(`registerDictionaryExtension`/`getDictionaryExtension`), preenchido por um
único import de efeito colateral que a extensão fornece, nunca
`@wordpress/hooks`.

## Consequências

Fica mais fácil: nenhuma das duas pontas vira superfície pública — só o
próprio `post-voice.php` (PHP) ou o próprio bundle (`index.tsx`, TS) decide
quem provê a porta, então um tema ou plugin de terceiro não pode registrar
nada sem editar o código do próprio Post Voice. Remover uma extensão sem
atualizar o wiring continua fatal error imediato (PHP) ou import quebrado
(TS) — a mesma falha alta que o projeto já tinha antes de qualquer aresta ser
resolvida, preservada de propósito.

Fica mais difícil: crescer ou remover uma extensão sempre toca o ponto de
wiring (um `post-voice.php`/`register-*-extension.ts` por porta) — não é
zero-touch para código de terceiro, ao contrário do que um filtro daria. É o
trade-off deliberado: ver "Alternativas rejeitadas".

## Como verificar

`review-manual` — não há regex que distinga DI explícita de acoplamento
direto disfarçado de DI. O que `feature-deps` (ADR-0005) já verifica
continua sendo a âncora mecânica: a aresta não pode crescer além do que
`desvios:` lista. Em review, perguntar: o wiring novo mora em
`post-voice.php` ou num módulo de registro explícito da própria extensão —
nunca em `apply_filters`/`add_filter`/`@wordpress/hooks` cruzando feature?

## Alternativas rejeitadas

**Filtro do WordPress** (`apply_filters`/`add_filter`, ou `@wordpress/hooks`
do lado TS). Resolve a aresta, mas é registro global por string: qualquer
tema ou plugin de terceiro pode hookar sem saber do projeto, e a falha muda
de fatal error imediato para degradação silenciosa (o recurso desaparece sem
log quando o registro não roda). Nenhum requisito do projeto pede
compatibilidade externa nesse ponto.

**Deixar as arestas congeladas indefinidamente**, sem nenhum mecanismo
padrão. É o que a ADR-0005 já fazia; esta ADR existe porque a pergunta "como
resolver quando alguém decidir resolver" apareceu de novo e vale a pena
responder uma vez.
```

- [ ] **Step 2: Atualizar `docs/adr/README.md`**

Adicionar a linha da ADR-0016 na tabela (depois da 0015):

```markdown
| [0016](0016-di-explicita-para-extensao-nucleo-satelite.md) | Injeção explícita no bootstrap, não filtro do WordPress, para arestas núcleo→satélite | aceita | `review-manual` |
```

- [ ] **Step 3: Rodar `npm run doctor` e conferir a ADR nova**

Run: `npm run doctor`
Expected: a ADR-0016 aparece na contagem por status (13 `aceita`), sem
reclamação de `origem` quebrada (o spec existe em
`docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md`) e
sem estouro do teto de 120 linhas.

- [ ] **Step 4: Rodar `npm run lint:arch`**

Run: `npm run lint:arch`
Expected: sai 0 — `enforced_by: [ review-manual ]` não precisa de regra
concreta nova (o literal `review-manual` é reconhecido, igual às ADRs 0003,
0007, 0010, 0012).

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0016-di-explicita-para-extensao-nucleo-satelite.md docs/adr/README.md
git commit -m "$(cat <<'EOF'
docs(adr): ADR-0016 — DI explícita, não filtro WP, para arestas núcleo→satélite

Registra o mecanismo escolhido nas Tasks 1 e 4 deste plano como
padrão do projeto para a próxima vez que uma aresta núcleo→satélite
precisar de resolução — a pergunta "filtro ou DI" já foi respondida
uma vez, com o porquê medido no research doc de 2026-08-27.

Spec: docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md
Claude-Session: https://claude.ai/code/session_01Q8Wrpnxmq3yLPVLWMsoNya
EOF
)"
```

---

## Task 7: Gate completo pré-PR

**Files:** nenhum arquivo novo — só verificação.

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a sequência exata do `CLAUDE.md`, na ordem**

Pré-requisito: `npx wp-env start` rodando.

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

Expected: tudo verde. `npm run test:unit -- --coverage` confirma que o gate
de 80% de linhas (ADR-0013) segue passando com os dois arquivos novos no
allowlist. `npm run test:e2e` baixa o modelo na primeira vez — nenhum
cenário deste plano deveria quebrar (nada aqui toca Worker, ONNX, nem o
fluxo de geração em si — só a origem do dicionário e do CSS do player).

- [ ] **Step 2: Se algo falhar, parar — não commitar, não abrir PR**

Por instrução do `CLAUDE.md`: reportar o que falhou com a saída real, a
causa raiz (não um palpite), e apresentar opções de correção antes de
prosseguir. Nenhum gate se afrouxa pra passar.

- [ ] **Step 3: Se tudo passar, `npm run doctor`**

Run: `npm run doctor`
Expected: "dívida congelada" mostra as 7 entradas remanescentes da ADR-0005
(nenhuma a mais, nenhuma a menos); "ADRs" mostra 13 `aceita` + 2
`aceita-com-desvio` (0004, 0005) + 1 nada mais (0011 continua
`aceita-com-desvio` também — 3 no total, como antes; só a 0005 mudou de
tamanho de lista).

- [ ] **Step 4: `superpowers:requesting-code-review`**

Por instrução do `CLAUDE.md`: com tudo verde, invocar a skill de code review
antes de abrir PR. Endereçar o que ela encontrar, ou explicar por que um
achado não se aplica.

- [ ] **Step 5: PR só se o usuário pedir**

Abrir PR é ação outward-facing — só acontece se pedida explicitamente,
depois do code review endereçado.
