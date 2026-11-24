// Print the recorded test results as the Markdown table the test page's "Copy results table" button makes.
//   node scripts/results-table.mjs                          (reads public/test-results.json)
//   node scripts/results-table.mjs path/to/export.json      (reads a file downloaded from the test page)
// No network, no key. It reads the file and does the sums, so every number in submission/TEST_SET.md can be checked.

import fs from 'node:fs';
import { normalizeRows, toMarkdown } from '../public/js/lab-core.js';

const file = process.argv[2] || new URL('../public/test-results.json', import.meta.url);
const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
const date = saved.recorded_at
  ? new Date(saved.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : '';
process.stdout.write(toMarkdown(normalizeRows(saved.rows), { origin: saved.origin || '', date }));
