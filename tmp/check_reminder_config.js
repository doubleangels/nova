const { getValue } = require('../utils/database');

async function checkConfig() {
  const role = await getValue('reminder_role');
  const channel = await getValue('reminder_channel');
  console.log('reminder_role:', role);
  console.log('reminder_channel:', channel);
  process.exit(0);
}

checkConfig();
