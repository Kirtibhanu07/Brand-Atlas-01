import fs from 'node:fs/promises';
export async function loadCatalog(file = new URL('../data/sports-events.json', import.meta.url)) {
  const rows=JSON.parse(await fs.readFile(file,'utf8')),ids=new Set();
  for(const row of rows){
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)||ids.has(row.id))throw new Error('Catalog IDs must be unique safe names');
    ids.add(row.id);
    const url=new URL(row.url);
    if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Catalog URLs must use public HTTPS');
    if(!row.name||!row.sport)throw new Error('Every event needs a name and sport');
  }
  return rows;
}
