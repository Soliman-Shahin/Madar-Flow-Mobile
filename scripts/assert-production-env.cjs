// Refuses a production build whose environment still points at a placeholder
// or at the staging backend. Run automatically by `npm run build:prod`.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');
const source = fs.readFileSync(file, 'utf8');
const urls = source.match(/https?:\/\/[^'"\s]+/g) || [];
const apiUrls = urls.filter((url) => !/googleapis|google\.com|gstatic/.test(url));

const forbidden = [
  { pattern: /\.invalid\b/, reason: 'placeholder host (.invalid)' },
  { pattern: /expenses-wallet\.up\.railway\.app/, reason: 'staging Railway backend' },
  { pattern: /localhost|127\.0\.0\.1/, reason: 'local development host' },
];

const problems = [];
for (const url of apiUrls)
  for (const { pattern, reason } of forbidden)
    if (pattern.test(url)) problems.push(`${url} -> ${reason}`);

if (problems.length) {
  console.error('\nProduction build blocked: environment.prod.ts is not ready.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nSet the real production API host in src/environments/environment.prod.ts.');
  console.error('For a staging build use `npm run build` or `npm run build:staging`.\n');
  process.exit(1);
}
console.log('environment.prod.ts: production API host looks valid.');
