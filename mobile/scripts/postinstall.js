#!/usr/bin/env node

/**
 * Postinstall script — patches react-native-screens codegen specs.
 *
 * RN 0.78's codegen can't resolve local type aliases used with
 * CT.WithDefault in some react-native-screens fabric specs.
 * This script inlines those type aliases so codegen succeeds.
 *
 * Tracked upstream: https://github.com/software-mansion/react-native-screens
 * Remove this patch once the fix is released.
 */

const fs = require('fs');
const path = require('path');

const fabricDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-screens',
  'src',
  'fabric',
);

if (!fs.existsSync(fabricDir)) {
  process.exit(0);
}

let patchCount = 0;

/**
 * Walk a directory recursively and return all .ts file paths.
 */
function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * For each codegen spec file, find local type aliases of the form:
 *   type Foo = 'a' | 'b' | 'c';
 * that are used in CT.WithDefault<Foo, 'a'> and inline the union type.
 */
for (const filePath of walkDir(fabricDir)) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Match: type TypeName = 'value1' | 'value2' | ...;
  const typeAliasPattern = /^type\s+(\w+)\s*=\s*((?:'[^']*'(?:\s*\|\s*'[^']*')*));/gm;
  const aliases = new Map();

  let match;
  while ((match = typeAliasPattern.exec(content)) !== null) {
    aliases.set(match[1], { fullMatch: match[0], unionType: match[2] });
  }

  // Check which aliases are used in CT.WithDefault<AliasName, ...>
  for (const [aliasName, { fullMatch, unionType }] of aliases) {
    const withDefaultPattern = new RegExp(
      `CT\\.WithDefault<${aliasName}\\b`,
    );
    if (withDefaultPattern.test(content)) {
      // Inline: replace CT.WithDefault<AliasName with CT.WithDefault<'a' | 'b'
      content = content.replace(
        new RegExp(`CT\\.WithDefault<${aliasName}\\b`, 'g'),
        `CT.WithDefault<${unionType}`,
      );
      // Remove the type alias line
      content = content.replace(fullMatch + '\n', '');
      // Handle case where line doesn't end with \n
      content = content.replace(fullMatch, '');
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    patchCount++;
    const relative = path.relative(fabricDir, filePath);
    console.log(`[postinstall] Patched: ${relative}`);
  }
}

if (patchCount > 0) {
  console.log(`[postinstall] Patched ${patchCount} react-native-screens codegen spec(s)`);
} else {
  console.log('[postinstall] react-native-screens codegen specs already patched or compatible');
}
