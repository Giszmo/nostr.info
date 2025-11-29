const path = require('path');

module.exports = {
  entry: {
    'charts': './src/charts/index.js'
  },
  output: {
    path: path.resolve(__dirname, 'assets/dist'),
    filename: '[name].js',
    library: 'NostrCharts',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react']
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx']
  },
  externals: {
    react: 'React',
    'react-dom': 'ReactDOM'
  }
};