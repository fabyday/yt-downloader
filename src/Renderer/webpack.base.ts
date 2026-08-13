import type { Configuration } from "webpack";

const path = require("node:path");
const CopyPlugin = require("copy-webpack-plugin");

const config: Configuration = {
  name: "renderer",
  target: "web",
  entry: path.resolve(__dirname, "app.ts"),
  output: {
    path: path.resolve(__dirname, "../../build/renderer"),
    filename: "app.js",
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true }
        }
      }
    ]
  },
  resolve: {
    alias: {
      motion: path.resolve(__dirname, "../../node_modules/motion"),
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom")
    },
    extensions: [".tsx", ".ts", ".js"]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "index.html"),
          to: "index.html"
        },
        {
          from: path.resolve(__dirname, "styles.css"),
          to: "styles.css"
        },
        {
          from: require.resolve("@kawaikara/kawai-ui/styles.css"),
          to: "kawai-ui.css"
        },
        {
          from: path.resolve(__dirname, "../Shared/locales"),
          to: "locales"
        }
      ]
    })
  ],
  stats: "errors-warnings"
};

module.exports = config;
