const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src', 'extension.ts')],
  bundle: true,
  platform: 'node',
  target: 'node14', 
  outfile: path.resolve(__dirname, 'dist', 'extension.js'),
  external: ['vscode'],
  sourcemap: false,
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
}).catch(() => process.exit(1));
