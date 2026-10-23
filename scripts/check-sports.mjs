// Full catalog runner: shared production crawl and asset pipeline, with incremental reports.
// Invoke the batch CLI directly for options; this compatibility entrypoint checks all events.
import {loadCatalog} from '../src/catalog.mjs';
import {runBatch} from '../src/batch.mjs';
const sites=await loadCatalog();
await runBatch(sites,{onProgress:(r,n,total)=>console.log(`${n}/${total} ${r.name}: ${r.outcome} (${r.downloadedLogos} saved logos)`)});
