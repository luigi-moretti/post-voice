<?php
/**
 * Tests for Post_Voice_Rest_Api.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Rest_Api
 */
class Test_Post_Voice_Rest_Api extends WP_UnitTestCase {

	/**
	 * Post the narration is saved against.
	 *
	 * @var int
	 */
	private int $post_id;

	/**
	 * User with both `edit_post` and `upload_files`.
	 *
	 * @var int
	 */
	private int $editor_id;

	public function set_up(): void {
		parent::set_up();

		// WP_UnitTestCase unregisters every meta key between tests, so re-register.
		Post_Voice_Post_Meta::register();

		// Routes must come from `rest_api_init` — calling register_routes()
		// directly trips WordPress's own _doing_it_wrong() notice, which the test
		// case turns into a failure. Rebuilding the server also keeps routes from
		// leaking between tests.
		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		do_action( 'rest_api_init', $wp_rest_server );

		$this->editor_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->post_id   = self::factory()->post->create( array( 'post_author' => $this->editor_id ) );
		wp_set_current_user( $this->editor_id );
	}

	/**
	 * Stage the fixture the way WP core's own attachment controller tests do.
	 *
	 * A bare tmp_name outside the recognised upload-tmp location trips WordPress's
	 * "possible file upload attack" rejection.
	 *
	 * @return array<string, mixed>
	 */
	private function staged_audio_fixture(): array {
		$source   = __DIR__ . '/fixtures/sample.mp3';
		$tmp_name = wp_tempnam( 'sample.mp3' );
		copy( $source, $tmp_name );

		return array(
			'name'     => 'narration.mp3',
			'type'     => 'audio/mpeg',
			'tmp_name' => $tmp_name,
			'error'    => 0,
			'size'     => filesize( $source ),
		);
	}

	public function test_rejects_request_without_upload_files_capability(): void {
		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		wp_set_current_user( $contributor );

		$request  = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'post_voice_forbidden', $response->as_error()->get_error_code() );
	}

	public function test_rejects_auto_draft_post_with_409(): void {
		$auto_draft_id = self::factory()->post->create(
			array(
				'post_status' => 'auto-draft',
				'post_author' => $this->editor_id,
			)
		);

		$request  = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$auto_draft_id}/narration" );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'post_voice_post_not_saved', $response->as_error()->get_error_code() );
	}

	public function test_rejects_missing_audio_file_with_400(): void {
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_missing_audio', $response->as_error()->get_error_code() );
	}

	public function test_rejects_unsupported_language_with_400(): void {
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'klingon' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_invalid_language', $response->as_error()->get_error_code() );
	}

	public function test_rejects_unsupported_voice_with_400(): void {
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'gandalf' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_invalid_voice', $response->as_error()->get_error_code() );
	}

	public function test_rejects_a_post_type_the_plugin_does_not_render_with_400(): void {
		// Nothing in the UI offers this, but the route is reachable directly and
		// a narration on a page is media no screen can ever show or remove.
		$page_id = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_author' => $this->editor_id,
			)
		);
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$page_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'alba' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_unsupported_post_type', $response->as_error()->get_error_code() );
		$this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $page_id ) );
	}

	public function test_rejects_malformed_source_hash_with_400(): void {
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'alba' );
		$request->set_param( 'source_hash', 'not-a-sha256' );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'post_voice_invalid_hash', $response->as_error()->get_error_code() );
	}

	public function test_saves_attachment_and_meta_on_valid_request(): void {
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'javert' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayHasKey( 'attachment_id', $data );
		$this->assertSame( 'portuguese', $data['language'] );
		$this->assertSame( 'javert', $data['voice'] );
		$this->assertSame( 'javert', get_post_meta( $this->post_id, Post_Voice_Post_Meta::VOICE, true ) );
		$this->assertSame( $data['attachment_id'], Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
		$this->assertSame( $this->post_id, get_post( $data['attachment_id'] )->post_parent );
	}

	public function test_regenerating_deletes_previous_attachment(): void {
		$first = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$first->set_param( 'language', 'portuguese' );
		$first->set_param( 'voice', 'alba' );
		$first->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$first->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );
		$first_id = rest_get_server()->dispatch( $first )->get_data()['attachment_id'];

		$second = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$second->set_param( 'language', 'spanish' );
		$second->set_param( 'voice', 'marius' );
		$second->set_param( 'source_hash', str_repeat( 'b', 64 ) );
		$second->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );
		$second_id = rest_get_server()->dispatch( $second )->get_data()['attachment_id'];

		$this->assertNotSame( $first_id, $second_id );
		$this->assertNull( get_post( $first_id ) );
		$this->assertSame( $second_id, Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
	}

	public function test_regenerating_never_reuses_the_previous_audio_url(): void {
		// Deleting the old attachment frees its filename, so the next upload was
		// handed the very same name and therefore the very same URL. The editor's
		// <audio> element sees an unchanged `src` string and keeps playing the
		// buffer it already loaded — the author saves a new narration and hears
		// the old one. The reader's browser cache does the same thing.
		$save = function () {
			$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
			$request->set_param( 'language', 'portuguese' );
			$request->set_param( 'voice', 'alba' );
			$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
			$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

			return rest_get_server()->dispatch( $request )->get_data();
		};

		// Three saves, not two: the second upload is pushed to `narration-1.mp3`
		// because `narration.mp3` still exists while it is being named, and only
		// then is the first deleted. The third save is handed the freed name back.
		$urls = array( $save()['url'], $save()['url'], $save()['url'] );

		$this->assertSame( $urls, array_unique( $urls ), 'Each narration needs its own URL.' );
	}

	public function test_sweeps_narrations_orphaned_by_a_concurrent_save(): void {
		// Two saves in flight at once each read the meta before the other wrote
		// it, so neither deleted the other's upload. Standing in for that here:
		// a narration attachment already parented to the post and marked as ours,
		// which the meta does not point at.
		$orphan_id = self::factory()->attachment->create_object(
			array(
				'file'           => 'orphan.mp3',
				'post_parent'    => $this->post_id,
				'post_mime_type' => 'audio/mpeg',
			)
		);
		Post_Voice_Post_Meta::mark_attachment( $orphan_id );

		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'alba' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$data = rest_get_server()->dispatch( $request )->get_data();

		$this->assertNull( get_post( $orphan_id ), 'The superseded narration should be gone.' );
		$this->assertSame(
			array( $data['attachment_id'] ),
			Post_Voice_Post_Meta::get_narration_attachment_ids( $this->post_id )
		);
		$this->assertSame( $data['attachment_id'], Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
	}

	public function test_keeps_exactly_one_narration_however_many_are_orphaned(): void {
		// Every concurrent save reaches the same verdict — highest attachment ID
		// wins — so the outcome does not depend on which request finishes last.
		// Sequential tests cannot interleave two real requests, so what is pinned
		// here is that verdict: any number of marked narrations collapses to one,
		// and the response names the survivor rather than whatever it uploaded.
		$orphans = array();
		foreach ( array( 'first.mp3', 'second.mp3' ) as $file ) {
			$orphan_id = self::factory()->attachment->create_object(
				array(
					'file'           => $file,
					'post_parent'    => $this->post_id,
					'post_mime_type' => 'audio/mpeg',
				)
			);
			Post_Voice_Post_Meta::mark_attachment( $orphan_id );
			$orphans[] = $orphan_id;
		}

		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'alba' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		$data      = rest_get_server()->dispatch( $request )->get_data();
		$remaining = Post_Voice_Post_Meta::get_narration_attachment_ids( $this->post_id );

		$this->assertCount( 1, $remaining );
		$this->assertSame( max( array_merge( $orphans, $remaining ) ), $remaining[0] );
		$this->assertSame( $remaining[0], $data['attachment_id'] );
		$this->assertSame( $remaining[0], Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
		$this->assertNotEmpty( $data['url'] );
	}

	public function test_leaves_audio_the_author_attached_themselves_alone(): void {
		$authors_own = self::factory()->attachment->create_object(
			array(
				'file'           => 'interview.mp3',
				'post_parent'    => $this->post_id,
				'post_mime_type' => 'audio/mpeg',
			)
		);

		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'alba' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		rest_get_server()->dispatch( $request );

		$this->assertNotNull( get_post( $authors_own ), 'Media the plugin did not create must survive.' );
	}

	public function test_removing_narration_deletes_the_audio_and_clears_the_meta(): void {
		$attachment_id = $this->save_a_narration();

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $response->get_data()['deleted'] );
		$this->assertNull( get_post( $attachment_id ) );
		$this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
		$this->assertSame( '', get_post_meta( $this->post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
		$this->assertSame( '', get_post_meta( $this->post_id, Post_Voice_Post_Meta::VOICE, true ) );
		$this->assertSame( '', get_post_meta( $this->post_id, Post_Voice_Post_Meta::SOURCE_HASH, true ) );
	}

	public function test_removing_narration_leaves_audio_the_author_attached_themselves(): void {
		$authors_own = self::factory()->attachment->create_object(
			array(
				'file'           => 'interview.mp3',
				'post_parent'    => $this->post_id,
				'post_mime_type' => 'audio/mpeg',
			)
		);
		$this->save_a_narration();

		rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertNotNull( get_post( $authors_own ) );
	}

	public function test_removing_narration_clears_meta_left_by_a_vanished_attachment(): void {
		// Meta from before the marker existed, or pointing at audio someone
		// removed by hand. Nothing to delete, but the panel and the frontend
		// player would keep advertising narration until the meta goes too.
		Post_Voice_Post_Meta::save( $this->post_id, 999999, 'portuguese', 'alba', str_repeat( 'a', 64 ) );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 0, $response->get_data()['deleted'] );
		$this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $this->post_id ) );
	}

	public function test_removing_nothing_reports_404(): void {
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'post_voice_no_narration', $response->as_error()->get_error_code() );
	}

	public function test_removing_narration_refused_for_a_user_who_cannot_edit_the_post(): void {
		$this->save_a_narration();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'post_voice_forbidden', $response->as_error()->get_error_code() );
	}

	public function test_removing_narration_refused_when_the_user_cannot_delete_the_audio(): void {
		// Deleting media is its own permission. A Contributor can edit their own
		// draft — so `edit_post` alone would have let this through — but WordPress
		// does not let them delete an attachment an editor uploaded.
		$attachment_id  = $this->save_a_narration();
		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		wp_update_post(
			array(
				'ID'          => $this->post_id,
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);
		wp_set_current_user( $contributor_id );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertNotNull( get_post( $attachment_id ) );
	}

	public function test_saving_does_not_claim_media_the_meta_was_pointed_at(): void {
		// The save path's mirror of the delete-anything hole. An editor uploads an
		// image while editing this post, so it is parented here but owned by them.
		// The author points `_narration_attachment_id` — REST-writable with nothing
		// but `edit_post` — at it, then saves a narration through the normal UI.
		// Marking that file made it a legitimate target for the sweep below, which
		// force-deletes without asking whether the caller could delete anything.
		$owner_id  = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$victim_id = self::factory()->attachment->create_object(
			array(
				'file'           => 'editors-photo.jpg',
				'post_parent'    => $this->post_id,
				'post_mime_type' => 'image/jpeg',
				'post_author'    => $owner_id,
			)
		);

		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		wp_update_post(
			array(
				'ID'          => $this->post_id,
				'post_author' => $author_id,
			)
		);
		wp_set_current_user( $author_id );
		Post_Voice_Post_Meta::save( $this->post_id, $victim_id, 'portuguese', 'alba', str_repeat( 'a', 64 ) );

		$this->save_a_narration();

		$this->assertNotNull( get_post( $victim_id ), 'Media the caller cannot delete must survive a save.' );
		$this->assertSame(
			'',
			get_post_meta( $victim_id, Post_Voice_Post_Meta::ATTACHMENT_MARKER, true ),
			'The plugin must not claim media it did not create.'
		);
	}

	public function test_removing_does_not_delete_media_the_meta_was_pointed_at(): void {
		// Same forgery against the DELETE endpoint. Deleting by marker is the
		// property the endpoint is built on, and only a real attachment can prove
		// it: a dangling ID would pass even if the code deleted whatever it named.
		$victim_id = self::factory()->attachment->create_object(
			array(
				'file'           => 'editors-photo.jpg',
				'post_parent'    => $this->post_id,
				'post_mime_type' => 'image/jpeg',
			)
		);
		Post_Voice_Post_Meta::save( $this->post_id, $victim_id, 'portuguese', 'alba', str_repeat( 'a', 64 ) );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', "/post-voice/v1/posts/{$this->post_id}/narration" )
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 0, $response->get_data()['deleted'] );
		$this->assertNotNull( get_post( $victim_id ) );
	}

	public function test_the_sweep_leaves_marked_audio_the_caller_cannot_delete(): void {
		// Belt and braces behind the guard above: even if something marks an
		// attachment the caller does not own, the sweep must refuse to destroy it.
		$owner_id   = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$foreign_id = self::factory()->attachment->create_object(
			array(
				'file'           => 'someone-elses.mp3',
				'post_parent'    => $this->post_id,
				'post_mime_type' => 'audio/mpeg',
				'post_author'    => $owner_id,
			)
		);
		Post_Voice_Post_Meta::mark_attachment( $foreign_id );

		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		wp_update_post(
			array(
				'ID'          => $this->post_id,
				'post_author' => $author_id,
			)
		);
		wp_set_current_user( $author_id );

		$this->save_a_narration();

		$this->assertNotNull( get_post( $foreign_id ) );
	}

	/**
	 * Save one narration through the endpoint and return its attachment ID.
	 */
	private function save_a_narration(): int {
		$request = new WP_REST_Request( 'POST', "/post-voice/v1/posts/{$this->post_id}/narration" );
		$request->set_param( 'language', 'portuguese' );
		$request->set_param( 'voice', 'alba' );
		$request->set_param( 'source_hash', str_repeat( 'a', 64 ) );
		$request->set_file_params( array( 'audio' => $this->staged_audio_fixture() ) );

		return rest_get_server()->dispatch( $request )->get_data()['attachment_id'];
	}
}
