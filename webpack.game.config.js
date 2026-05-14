const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

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
        { from: 'src/game/index.html',     to: 'index.html'     },
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
    port: 9010,
    hot: false,
    liveReload: true,
    client: {
      logging: 'none',
      overlay: false,
      webSocketTransport: 'sockjs',
    },
    webSocketServer: 'sockjs',
    host: '0.0.0.0',
    allowedHosts: 'all',
    headers: {
      'Cache-Control': 'no-store',
    },
    setupMiddlewares: (middlewares, devServer) => {
      let lastBuildTime = new Date().toISOString();

      // Updated after every successful compilation
      devServer.compiler.hooks.done.tap('BuildTimeTracker', () => {
        lastBuildTime = new Date().toISOString();
      });

      devServer.app.get('/build-time', (_req, res) => res.json({ time: lastBuildTime }));

      devServer.app.use((req, res, next) => {
        const ts = new Date().toISOString().slice(11, 23);
        console.log(`[${ts}] HTTP ${req.method} ${req.url}`);
        next();
      });

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
