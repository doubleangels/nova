const axios = require('axios');

axios.defaults = axios.defaults || {};
if (!axios.defaults.timeout) {
  axios.defaults.timeout = 10000;
}

module.exports = axios;
