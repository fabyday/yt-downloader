import type { Configuration } from "webpack";

const path = require("node:path");

const config: Configuration = {
  name: "main",
  target: "electron-main",
  entry: path.resolve(__dirname, "main.ts"),
  output: {
    path: path.resolve(__dirname, "../../build/main"),
    filename: "main.js",
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
