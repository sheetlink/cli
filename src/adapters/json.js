/**
 * json.js - JSON stdout adapter
 *
 * Writes full sync result to stdout as JSON.
 * Pipeable: sheetlink sync | jq '.transactions[] | select(.amount > 100)'
 */

export function writeJson(result) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
