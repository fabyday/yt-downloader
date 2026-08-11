import type { Configuration } from "webpack";

const path = require("node:path");

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
  node: {
    __dirname: false,
    __filename: false
  },
  stats: "errors-warnings"
};

module.exports = config;
