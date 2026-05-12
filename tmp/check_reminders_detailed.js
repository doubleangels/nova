const { getKeyvForNamespace } = require('../utils/dbScriptUtils');

async function checkReminders() {
  const mainKv = getKeyvForNamespace('main');
  const reminderKv = getKeyvForNamespace('nova_reminders');

  console.log('--- MAIN NAMESPACE SETTINGS (with and without prefix) ---');
  const keys = ['reminder_channel', 'reminder_role', 'reminder_delay_bump_ms', 'reminder_delay_promote_ms', 'reminder_delay_needafriend_ms'];
  for (const k of keys) {
    const rawVal = await mainKv.get(k);
    const configVal = await mainKv.get('config:' + k);
    console.log(`${k}:`, rawVal, '| config:' + k + ':', configVal);
  }

  console.log('\n--- NOVA_REMINDERS NAMESPACE ---');
  const types = ['bump', 'promote', 'needafriend'];
  for (const t of types) {
    const listKey = `reminders:${t}:list`;
    const list = await reminderKv.get(listKey);
    console.log(`${listKey}:`, list);
    if (Array.isArray(list)) {
      for (const rid of list) {
        const rdata = await reminderKv.get(`reminder:${rid}`);
        console.log(`  reminder:${rid}:`, rdata);
      }
    }
  }
}

checkReminders().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
