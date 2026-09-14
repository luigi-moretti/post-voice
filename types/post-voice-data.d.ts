import type { DictionaryEntryShape as DictionaryEntry } from '../features/narration/editor/dictionary-extension';

declare global {
	interface Window {
		postVoiceData?: {
			/** Site-wide pronunciation entries, read-only in the editor. */
			dictionary: DictionaryEntry[];
			/** Raw WordPress locale, e.g. `pt_BR`. Mapped to a bundle client-side. */
			siteLanguage: string;
			/** Whether to offer the link to the site dictionary. */
			canManageOptions: boolean;
			/**
			 * Cache-busted URL of the narration Worker's own script
			 * (`build/pocket-tts-worker.js?ver=...`). Empty string if the build
			 * output is missing (mirrors every other asset guard in
			 * `Post_Voice_Assets`).
			 */
			workerUrl: string;
			/**
			 * Whether the site asked, through the
			 * `post_voice_force_single_thread` filter, that generation run
			 * single-threaded even on an isolated editor. A diagnostic hatch
			 * with no UI; see `Post_Voice_Assets`.
			 *
			 * `''` or `'1'`, not a boolean: `wp_localize_script()` stringifies
			 * every value it is given, writing `false` as the empty string.
			 * Read it through `Boolean()`, never with `=== true`.
			 */
			forceSingleThread: '' | '1';
		};
	}
}

export {};
