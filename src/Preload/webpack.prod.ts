import type { Configuration } from "webpack";

const baseConfig = require("./webpack.base.ts") as Configuration;

const config: Configuration = {
  ...baseConfig,
  mode: "production",
  devtool: false
};

module.exports = config;
