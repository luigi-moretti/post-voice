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
}
