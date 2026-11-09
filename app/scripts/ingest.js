#!/usr/bin/env node
// Creates the `talks` index (mapping from docs/contracts.md) and loads data/talks.json.
// Idempotent: creates the index only if missing, upserts by id and removes talks no longer in the file.
// Usage (from app/): node --env-file=<credentials file> scripts/ingest.js [--recreate]
const { INDEX, MAPPINGS, getClient, semanticText } = require('../src/search/elastic');
const talks = require('../data/talks.json');

const INDEXED_FIELDS = Object.keys(MAPPINGS.properties).filter((f) => f !== 'semantic');

async function main() {
  const es = getClient();
  if (!es) {
    console.error('ELASTIC_ENDPOINT and ELASTIC_API_KEY are required');
    process.exit(1);
  }
  // Ingest embeds every document; a cold inference endpoint can take minutes on the first call.
  const opts = { requestTimeout: 300000 };

  if (process.argv.includes('--recreate') && (await es.indices.exists({ index: INDEX }))) {
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

  const stale = await es.deleteByQuery(
    { index: INDEX, query: { bool: { must_not: { ids: { values: talks.map((t) => t.id) } } } }, refresh: true },
    opts,
  );

  const { count } = await es.count({ index: INDEX });
  console.log(`indexed ${talks.length} talks, removed ${stale.deleted} stale, index now has ${count}`);
}

main().catch((err) => {
  console.error('ingest failed:', err.meta?.body?.error?.reason || err.message);
  process.exit(1);
});
