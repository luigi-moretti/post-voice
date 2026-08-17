/**
 * Throwaway identities for dictionary rows, used as React keys and nothing else.
 *
 * Deliberately not `crypto.randomUUID()`. That API is secure-context-only, and
 * a plain-HTTP editor is a state this plugin explicitly supports: `ensureEngine`
 * detects it and answers with a sentence ("Narration needs a secure
 * connection…") instead of failing obscurely. A panel that called
 * `randomUUID()` in a render path threw there before that sentence could ever be
 * shown — opening any post with a single saved dictionary entry was enough — and
 * the whole sidebar came down with Gutenberg's generic error boundary.
 *
 * Deliberately not the array index either. Rows are keyed by identity because
 * keying them by position made React reuse the wrong input when a row was
 * removed, and the author lost focus mid-typing.
 *
 * A module-scope counter, not a per-component one: it has to keep producing
 * fresh ids across the panel's remounts (the sidebar unmounts every time the
 * author switches to the block inspector), and uniqueness only has to hold
 * within one page.
 *
 * These ids never reach the saved data. They live in the panel's own state; the
 * entries written to post meta carry `term`, `replacement` and `language` only.
 */
let counter = 0;

/**
 * The next unused row id.
 */
export function nextRowId(): string {
	counter += 1;
	return `post-voice-dictionary-row-${ counter }`;
}
