const fs = require('fs');
const path = require('path');

describe('command module registration', () => {
  it('should load every command module so SlashCommandBuilder callbacks run', async () => {
    const commandsDir = path.join(__dirname, '../../commands');
    const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      jest.isolateModules(() => {
        const cmd = require(path.join(commandsDir, file));
        expect(cmd.data).toBeDefined();
        expect(cmd.execute).toBeInstanceOf(Function);
        const json = cmd.data.toJSON();
        expect(json.name).toBeDefined();
      });
    }
  });
});
