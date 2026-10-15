// Site-wide on/off switches. The values live in server/data/features.json,
// which the app reads too (client/src/features.js), so one edit turns a
// feature off or on everywhere.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FEATURES = JSON.parse(fs.readFileSync(path.join(here, 'data', 'features.json'), 'utf8'));

/**
 * The paid Premium tier. Off, nobody is Premium (store.isPremium), so its
 * perks — daily alerts, the Recruiting Kit, sample interview answers, no
 * ads — are off too; its page, buttons and links are hidden; and its
 * payment routes are not registered. Past payments still show on /owner and
 * refunds still arrive through the Stripe webhook.
 */
export const PREMIUM_ENABLED = FEATURES.premium === true;
