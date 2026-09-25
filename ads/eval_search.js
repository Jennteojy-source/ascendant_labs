#!/usr/bin/env node
/** Read one search's decision trail and subsequent media/browser outcomes. */
require('./lib/local_env').loadLocalEnv();
const { getSearchEvaluation } = require('./lib/search_logger');

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('Usage: node ads/eval_search.js search_ID');
  const report = await getSearchEvaluation(id);
  if (!report) throw new Error(`No evaluation found for ${id}`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
})().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
