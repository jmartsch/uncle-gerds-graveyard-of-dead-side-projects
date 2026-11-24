// Run the curator from the command line:
//   node scripts/scan.js                       pick dead repos automatically
//   node scripts/scan.js --repos=me/a,me/b     hand-pick exhibits
//   node scripts/scan.js --max=5
import { runScan } from '../lib/curator.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const repos = (arg('repos') || '').split(',').map((s) => s.trim()).filter(Boolean);
const max = Number(arg('max')) || undefined;

try {
  const exhibits = await runScan({ ...(repos.length ? { repos } : {}), ...(max ? { max } : {}) });
  console.log(`\n${exhibits.length} exhibits written to data/exhibits.json:`);
  for (const e of exhibits) console.log(`  • ${e.title} (${e.repo}) – revival ${e.odds?.revival == null ? '?' : `${Math.round(e.odds.revival * 100)}%`}`);
} catch (err) {
  console.error(`Scan failed: ${err.message}`);
  process.exit(1);
}
