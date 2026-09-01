import type { DictionaryEntry } from '../features/pronunciation/editor/dictionary-entry';

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
		};
	}
}

export {};
