/**
 * Bundle the Lambda handler into one ES module file for upload: dist/handler.mjs.
 *
 * Everything is bundled, including @aws-sdk/cloudfront-signer, which is not part of the
 * Lambda runtime's built-in SDK. The banner gives bundled CommonJS dependencies a
 * working `require` inside the ES module output.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/handler.js'],
  outfile: 'dist/handler.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
