import type { Configuration } from "webpack";

const baseConfig = require("./webpack.base.ts") as Configuration;

const config: Configuration = {
  ...baseConfig,
  mode: "development",
  devtool: "source-map"
};

module.exports = config;
