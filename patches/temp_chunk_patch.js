const fs = require('fs');
const src = fs.readFileSync('node_modules/prismarine-chunk/src/index.js', 'utf8');
const replaced = src.replace(
  "1.21: require('./pc/1.18/chunk')",
  "1.21: require('./pc/1.18/chunk'),\n      26.1: require('./pc/1.18/chunk')"
);
fs.writeFileSync('node_modules/prismarine-chunk/src/index.js', replaced);
console.log('Done');
