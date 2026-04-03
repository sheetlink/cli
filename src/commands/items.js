/**
 * items.js - `sheetlink items`
 *
 * Lists all connected bank accounts for the authenticated user.
 */

import { listItems } from '../api.js';

export async function cmdItems() {
  const { items } = await listItems();

  if (!items || items.length === 0) {
    console.log('No connected banks. Connect one at https://sheetlink.app/dashboard');
    return;
  }

  console.log(`\nConnected banks (${items.length}):\n`);
  for (const item of items) {
    const lastSync = item.last_synced_at
      ? new Date(item.last_synced_at).toLocaleString()
      : 'never';
    console.log(`  ${item.institution_name || 'Unknown'}`);
    console.log(`    item_id:      ${item.item_id}`);
    console.log(`    last synced:  ${lastSync}`);
    console.log('');
  }
}
