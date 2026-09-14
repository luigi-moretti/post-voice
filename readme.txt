=== Post Voice ===
Contributors: (your wordpress.org username, once distributed)
Tags: text to speech, audio, accessibility, narration, voice
Requires at least: 6.6
Tested up to: 6.6
Requires PHP: 8.2
Stable tag: 0.5.2
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Generate spoken-word narration for your posts, entirely in the author's browser — no server-side processing, no per-request cost.

== Description ==

Post Voice adds a "Narration" panel to the block editor. Authors pick a language, generate audio locally in the browser (Pocket TTS, WebAssembly), preview it, and save it as the post's narration. Readers get a small floating player that reads the post aloud.

The first generation downloads a voice model of roughly 190MB to the browser's storage. It is cached afterwards, so later generations do not download it again.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/post-voice`.
2. Activate through the 'Plugins' screen.
3. Open any post, click the "Narration" icon in the editor sidebar.

== Frequently Asked Questions ==

= Does this send my post text to a third-party service? =

No. Speech synthesis runs entirely in your own browser. The only network requests
are for the voice model files themselves, downloaded from a pinned Hugging Face
mirror.

= An embed (CodePen, YouTube) shows up blank in the post editor. Why? =

To generate narration faster, the plugin makes the post editor screen
cross-origin isolated, and an isolated page blocks any embed from another site
that does not opt in to isolation itself — most do not. Only the editing screen
is affected: your published posts, and what your visitors see, never change.

Go to Settings -> Narration and untick "Generate narration faster", then reload
the editor. Narration keeps working; it just uses one processor core instead of
all of them, so generation takes longer.

= Why does generation need HTTPS? =

The plugin uses the Web Crypto API and audio worklets, which browsers expose only
in a secure context. On a plain-HTTP site the panel reports this instead of
failing partway through.

== Notice ==

The underlying model supports voice cloning. Do not use it to imitate a real
person's voice without that person's consent.

== Changelog ==

= 0.1.0 =
* Initial MVP release: single-language narration per post, sticky mobile player.
