const fs = require('fs');
let content = fs.readFileSync('tests/utils/predictionMessages.test.js', 'utf8');

content = content.replace(
  /expect\(msgs\.formatMyPickLine\(0, 0, 'Draw', false\)\)\.toContain\('awaiting final score'\);/,
  "expect(msgs.formatMyPickLine(0, 0, 'Draw', false)).toContain('awaiting final score');\n    expect(msgs.formatMyPickLine(1, 0, 'Home', true)).toContain('+0');"
);

content = content.replace(
  /expect\(content\)\.toContain\('Choose home goals'\);\r?\n  \}\);/,
  `expect(content).toContain('Choose home goals');\n\n    const contentUndefined = msgs.buildPredictionFormContentWithPick(\n      { home: 'Arsenal', away: 'Chelsea' },\n      formatTeam,\n      () => ''\n    );\n    expect(contentUndefined).toContain('Choose home goals');\n  });`
);

fs.writeFileSync('tests/utils/predictionMessages.test.js', content);
console.log('patched');
