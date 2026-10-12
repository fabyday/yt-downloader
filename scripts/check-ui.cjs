const fs = require('node:fs');

function checkUi() {
  for (const entry of ['@kawaikara/kawai-ui', '@kawaikara/kawai-ui/styles.css']) {
    const file = require.resolve(entry);
    if (!fs.statSync(file).isFile()) throw new Error(`Missing packaged KawaiUI asset: ${entry}`);
  }
}

module.exports = { checkUi };
if (require.main === module) { checkUi(); console.log('Packaged KawaiUI assets verified (no sibling checkout required).'); }
