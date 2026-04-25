const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    game:      './src/game/index.ts',
    testTruck: './src/game/testTruck.ts',
  },
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: { configFile: 'tsconfig.game.json' },
        },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/game/index.html',     to: 'game.html'      },
        { from: 'src/game/testTruck.html', to: 'testTruck.html' },
      ],
    }),
  ],
  resolve: { extensions: ['.ts', '.js'] },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
      watch: false,   // don't watch dist/ — bundle writes were triggering live reloads
    },
    compress: true,
    port: 9000,
    hot: false,
    liveReload: false,
    client: false,     // don't inject WebSocket client — its reconnect logic was reloading the page
    host: '0.0.0.0',
    allowedHosts: 'all',
    headers: {
      // Prevent iOS from caching the bundle — old cached bundles contained the
      // webpack HMR client which triggered rapid page reloads when HMR 404'd.
      'Cache-Control': 'no-store',
    },
    setupMiddlewares: (middlewares, devServer) => {
      // Log every HTTP request so we can see page-reload loops even if JS never runs
      devServer.app.use((req, res, next) => {
        const ts = new Date().toISOString().slice(11, 23);
        console.log(`[${ts}] HTTP ${req.method} ${req.url}`);
        next();
      });

      // Client-side log endpoint (supports GET from sendBeacon/fetch and POST from sendBeacon)
      const handleLog = (req, res) => {
        const level = (req.query.level || 'LOG').toString().toUpperCase();
        const msg   = decodeURIComponent((req.query.msg  || '').toString());
        const ts    = new Date().toISOString().slice(11, 23);
        console.log(`[${ts}] [CLIENT ${level}] ${msg}`);
        res.json({ ok: true });
      };
      devServer.app.get('/log',  handleLog);
      devServer.app.post('/log', handleLog);

      return middlewares;
    },
  },
};
