#!/usr/bin/env node

/**
 * Postinstall script — patches react-native-screens codegen spec.
 *
 * The BottomTabsAccessoryContentNativeComponent.ts uses a type alias
 * for the "environment" prop that RN 0.78's codegen can't resolve.
 * This inlines the union type so codegen succeeds.
 *
 * Tracked upstream: https://github.com/software-mansion/react-native-screens
 * Remove this patch once the fix is released.
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-screens',
  'src',
  'fabric',
  'bottom-tabs',
  'BottomTabsAccessoryContentNativeComponent.ts',
);

if (!fs.existsSync(filePath)) {
  // Library not installed or file structure changed — skip silently
  process.exit(0);
}

const original = fs.readFileSync(filePath, 'utf8');

// Only patch if the type alias pattern is present
if (original.includes("type BottomAccessoryEnvironment = 'regular' | 'inline'")) {
  const patched = original
    // Remove the type alias line
    .replace(
      "type BottomAccessoryEnvironment = 'regular' | 'inline';\n",
      '',
    )
    // Inline the union type in the prop definition
    .replace(
      'CT.WithDefault<BottomAccessoryEnvironment,',
      "CT.WithDefault<'regular' | 'inline',",
    );

  fs.writeFileSync(filePath, patched, 'utf8');
  console.log('[postinstall] Patched react-native-screens codegen spec (environment prop)');
} else {
  console.log('[postinstall] react-native-screens codegen spec already patched or updated');
}
