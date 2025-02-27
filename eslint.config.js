// eslint.config.js
module.exports = [
  {
    // Define the files that this configuration applies to.
    files: ["**/*.js"],
    
    // Replace the "env" key with languageOptions.
    languageOptions: {
      parserOptions: {
        // Use ECMAScript 2021 as specified.
        ecmaVersion: 2021,
        sourceType: "module",
      },
      // Define global variables that are available in both browser and Node environments.
      globals: {
        // Node globals
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        // Browser globals
        window: "readonly",
        document: "readonly",
      },
    },
    
    // Extend the recommended ESLint rules.
    extends: ["eslint:recommended"],
    
    // Define your custom rules.
    rules: {
      semi: ["error", "always"],
    },
  },
];
