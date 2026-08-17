/**
 * Settings screen entry: the live preview of the reader's player.
 *
 * Vanilla TS, not React, for the same reason the dictionary screen is: this is
 * a plain WordPress settings form posted to `options.php`, and the editor's
 * React runtime would be a large dependency for a handful of listeners.
 */

import './style.scss';
import { initPreview } from './preview';

document.addEventListener( 'DOMContentLoaded', () => initPreview() );
