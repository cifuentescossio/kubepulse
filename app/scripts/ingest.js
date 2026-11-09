#!/usr/bin/env node
// Creates the `talks` index (mapping from docs/contracts.md) and loads data/talks.json.
// Idempotent: creates the index only if missing and upserts by id. By default it never deletes.
// --prune also removes talks that are no longer in the file, but refuses to when the file has
// fewer than 80% of the documents in the index (a truncated or wrong catalog would wipe search).
// Usage (from app/): node --env-file=<credentials file> scripts/ingest.js [--prune] [--recreate]
const { INDEX, MAPPINGS, getClient, semanticText } = require('../src/search/elastic');
const talks = require('../data/talks.json');

const INDEXED_FIELDS = Object.keys(MAPPINGS.properties).filter((f) => f !== 'semantic');
const MIN_PRUNE_RATIO = 0.8;

// Whether pruning is safe: the catalog must hold at least 80% as many talks as the index.
function pruneCheck(catalogCount, indexCount) {
  if (indexCount === 0 || catalogCount >= MIN_PRUNE_RATIO * indexCount) return { ok: true };
  return {
    ok: false,
    reason: `catalog has ${catalogCount} talks but the index has ${indexCount} (below ${MIN_PRUNE_RATIO * 100}%), not pruning`,
  };
}

async function main(argv = process.argv) {
  const prune = argv.includes('--prune');
  const es = getClient();
  if (!es) {
    console.error('ELASTIC_ENDPOINT and ELASTIC_API_KEY are required');
    process.exit(1);
  }
  // Ingest embeds every document; a cold inference endpoint can take minutes on the first call.
  const opts = { requestTimeout: 300000 };

  if (argv.includes('--recreate') && (await es.indices.exists({ index: INDEX }))) {
    await es.indices.delete({ index: INDEX });
    console.log(`deleted index ${INDEX}`);
  }

  if (await es.indices.exists({ index: INDEX })) {
    await es.indices.putMapping({ index: INDEX, ...MAPPINGS }, opts);
    console.log(`index ${INDEX} exists, mapping checked`);
  } else {
    await es.indices.create({ index: INDEX, mappings: MAPPINGS }, opts);
    console.log(`created index ${INDEX}`);
  }

  // Check before writing anything, so an aborted prune leaves the index exactly as it was.
  if (prune) {
    const { count: before } = await es.count({ index: INDEX });
    const check = pruneCheck(talks.length, before);
    if (!check.ok) {
      console.error(`ingest aborted: ${check.reason}`);
      process.exit(1);
    }
  }

  const operations = talks.flatMap((talk) => {
    const doc = Object.fromEntries(INDEXED_FIELDS.map((f) => [f, talk[f]]));
    doc.semantic = semanticText(talk);
    return [{ index: { _index: INDEX, _id: talk.id } }, doc];
  });
  const bulk = await es.bulk({ operations, refresh: 'wait_for' }, opts);
  if (bulk.errors) {
    const failed = bulk.items.filter((i) => i.index?.error);
    for (const item of failed.slice(0, 5)) console.error(item.index._id, item.index.error.reason);
    throw new Error(`${failed.length} of ${talks.length} documents failed`);
  }

  let removed = 0;
  if (prune) {
    const stale = await es.deleteByQuery(
      { index: INDEX, query: { bool: { must_not: { ids: { values: talks.map((t) => t.id) } } } }, refresh: true },
      opts,
    );
    removed = stale.deleted;
  }

  const { count } = await es.count({ index: INDEX });
  const pruned = prune ? `removed ${removed} stale` : 'no pruning (pass --prune to remove stale talks)';
  console.log(`indexed ${talks.length} talks, ${pruned}, index now has ${count}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('ingest failed:', err.meta?.body?.error?.reason || err.message);
    process.exit(1);
  });
}

module.exports = { MIN_PRUNE_RATIO, pruneCheck };
