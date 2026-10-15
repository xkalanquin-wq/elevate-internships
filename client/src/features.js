// Site-wide on/off switches, from the same file the server reads
// (server/data/features.json), so the app and the server always agree.
import FEATURES from '../../server/data/features.json';

/** The paid Premium tier: its account section, links and buttons. */
export const PREMIUM_ENABLED = FEATURES.premium === true;
