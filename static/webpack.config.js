const HTMLWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

module.exports = {
  // Entry points for your application
  entry: {
    colors: path.resolve(__dirname, "src", "js", "colors.js"),
    audio: path.resolve(__dirname, "src", "js", "audio.js"),
    visualizer: path.resolve(__dirname, "src", "js", "visualizers", "index.js"),
    timebytime: path.resolve(__dirname, "src", "js", "timebytime.js")
  },
  mode: "production",
  target: "web",
  devServer: {
    hot: false
  },
  output: {
    path: path.resolve(__dirname, 'src', 'js', 'dist'),
    filename: '[name].js',
    library: {
      name: 'musicolors',
      type: 'umd',
      export: 'default',
    },
    globalObject: 'this',
  },
  plugins: [new HTMLWebpackPlugin({})],
  externals: {
    // Allow consumers to provide their own Three.js if desired
    // but bundle it by default for standalone use
  },
};
