import type { Configuration } from "webpack";

const path = require("node:path");

const config: Configuration = {
  name: "preload",
  target: "electron-preload",
  entry: path.resolve(__dirname, "preload.ts"),
  output: {
    path: path.resolve(__dirname, "../../build/preload"),
    filename: "preload.js",
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
  node: {
    __dirname: false,
    __filename: false
  },
  stats: "errors-warnings"
};

module.exports = config;
