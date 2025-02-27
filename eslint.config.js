// eslint.config.js
const { flatConfigs } = require("eslint/use-at-your-own-risk");

module.exports = [
  flatConfigs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
      },
      globals: {
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        window: "readonly",
        document: "readonly",
      },
    },
    rules: {
      semi: ["error", "always"],
    },
  },
];
