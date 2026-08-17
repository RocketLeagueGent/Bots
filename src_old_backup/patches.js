const SERVER_VER = '26.1.2';

// Patch mineflayer loader to skip version check for 26.1.2
const fs = require('fs');
const loaderPath = require.resolve('mineflayer/lib/loader.js');
let src = fs.readFileSync(loaderPath, 'utf8');

const bakPath = loaderPath + '.bak';
if (!fs.existsSync(bakPath)) {
  fs.writeFileSync(bakPath, src);
}

src = src.replace(
  "if (!bot.registry?.version && serverPingVersion !== '26.1.2')",
  "if (!bot.registry?.version && serverPingVersion !== '" + SERVER_VER + "')"
);

src = src.replace(
  "if (versionData['>'](latestSupportedVersion) && (versionData.version !== latestSupportedProtocolVersion) && serverPingVersion !== '26.1.2')",
  "if (versionData['>'](latestSupportedVersion) && (versionData.version !== latestSupportedProtocolVersion) && serverPingVersion !== '" + SERVER_VER + "')"
);

src = src.replace(
  "} else if (versionData['<'](oldestSupportedVersion) && serverPingVersion !== '26.1.2')",
  "} else if (versionData['<'](oldestSupportedVersion) && serverPingVersion !== '" + SERVER_VER + "')"
);

fs.writeFileSync(loaderPath, src);

console.log('[PATCH] Applied patches for', SERVER_VER);
