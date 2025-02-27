// eslint.config.js
const recommended = require("eslint/conf/eslint-recommended");

module.exports = [
  // Include the recommended ESLint config
  recommended,
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
