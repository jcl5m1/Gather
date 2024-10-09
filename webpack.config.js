const path = require('path');
const fs = require('fs');

module.exports = {
  entry: './src/index.ts',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    compress: true,
    port: 8000,
    hot: true,
    liveReload: true,
    open: false,
    host: '0.0.0.0', // Accept connections from any IP
    allowedHosts: 'all',
    // server: {
    //   type: 'https',
    //   options: {
    //     key: fs.readFileSync(path.join(__dirname, 'server.key')),
    //     cert: fs.readFileSync(path.join(__dirname, 'server.crt')),
    //   },
    // },
  },
};