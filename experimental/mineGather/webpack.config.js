const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Archived project. Build from repo root:
//   npm run build:mine   /   npm run start:mine
module.exports = {
  context: __dirname,
  entry: './index.ts',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: { configFile: path.resolve(__dirname, 'tsconfig.json') },
        },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: 'index.html', to: 'index.html' }],
    }),
  ],
  resolve: { extensions: ['.ts', '.js'] },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, '../../dist'),
  },
  devServer: {
    static: { directory: path.resolve(__dirname, '../../dist') },
    compress: true,
    port: 8000,
    hot: true,
    liveReload: true,
    open: false,
    host: '0.0.0.0',
    allowedHosts: 'all',
  },
};
