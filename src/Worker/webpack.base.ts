import type { Configuration } from "webpack";

const path = require("node:path");
const CopyPlugin = require("copy-webpack-plugin");

const config: Configuration = {
  name: "worker",
  target: "node",
  entry: path.resolve(__dirname, "index.ts"),
  output: {
    path: path.resolve(__dirname, "../../build/worker"),
    filename: "worker.js",
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true }
        }
      }
    ]
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  plugins: [new CopyPlugin({ patterns: [{
    from: path.resolve(__dirname, "yt-dlp-plugins"), to: "yt-dlp-plugins",
    globOptions: { ignore: ["**/__pycache__/**", "**/*.pyc"] },
  }] })],
  node: {
    __dirname: false,
    __filename: false
  },
  stats: "errors-warnings"
};

module.exports = config;
