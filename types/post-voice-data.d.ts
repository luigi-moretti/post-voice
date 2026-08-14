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
		};
	}
}

export {};
