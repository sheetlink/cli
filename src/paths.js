/**
 * paths.js - "~" means your home folder in every path the CLI takes.
 *
 * Shells only expand ~ at the start of an unquoted word, so "sqlite:///~/finance.db" reaches the CLI
 * with the ~ intact (and, after "sqlite://" is stripped, as "/~/finance.db"), and so does a quoted
 * --file "~/finances.csv". Both now mean the home folder.
 */

import os from 'os';

export function expandHome(p) {
  if (!p) return p;
  return p.replace(/^\/?~(?=[\/\\]|$)/, os.homedir());
}
