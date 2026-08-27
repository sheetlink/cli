/**
 * items.js - `sheetlink items`
 *
 * Lists all connected banks and their accounts for the authenticated user, marking which
 * accounts sync to your destination and which are excluded. Filtering is managed in the
 * SheetLink extension, web dashboard, or Excel add-in (this command is read-only).
 */

import { listItems } from '../api.js';

export async function cmdItems() {
  const { items } = await listItems();

  if (!items || items.length === 0) {
    console.log('No connected banks. Connect one at https://sheetlink.app/dashboard');
    return;
  }

  console.log(`\nConnected banks (${items.length}):\n`);
  let anyExcluded = false;

  for (const item of items) {
    const lastSync = item.last_synced_at
      ? new Date(item.last_synced_at).toLocaleString()
      : 'never';
    const bankName = item.nickname || item.institution_name || 'Unknown';
    console.log(`  ${bankName}`);
    console.log(`    item_id:      ${item.item_id}`);
    console.log(`    last synced:  ${lastSync}`);

    const accounts = item.accounts || [];
    const excluded = new Set((item.synced_account_ids && item.synced_account_ids.excluded) || []);
    if (accounts.length) {
      console.log('    accounts:');
      for (const a of accounts) {
        const nick = (item.account_nicknames && item.account_nicknames[a.account_id] && item.account_nicknames[a.account_id].nickname) || '';
        const name = nick || a.name || a.official_name || 'Account';
        const mask = a.mask ? ` ••${a.mask}` : '';
        const type = a.subtype || a.type || '';
        const isExcluded = excluded.has(a.account_id);
        if (isExcluded) anyExcluded = true;
        // check = syncs to your destination, cross = excluded (won't sync).
        const marker = isExcluded ? '✗' : '✓';
        const tag = isExcluded ? '  (not syncing)' : '';
        const typeStr = type ? `  ${type}` : '';
        console.log(`      ${marker} ${name}${mask}${typeStr}${tag}`);
      }
    } else {
      // Cache not populated yet (item never synced since account caching shipped).
      console.log('    accounts:     run `sheetlink sync` to load accounts');
    }
    console.log('');
  }

  if (anyExcluded) {
    console.log('  ✗ = excluded from syncing. Manage which accounts sync in the SheetLink');
    console.log('    extension, web dashboard (sheetlink.app/dashboard/banks), or Excel add-in.\n');
  }
}
