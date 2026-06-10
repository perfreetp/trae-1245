const chalk = require('chalk');
const store = require('../store');

function log(options) {
  const logs = store.load('log');
  const action = options.action || '';
  const limit = parseInt(options.limit) || 20;

  let filtered = logs;
  if (action) {
    filtered = logs.filter(l => l.action === action);
  }

  const recent = filtered.slice(-limit).reverse();

  if (recent.length === 0) {
    console.log(chalk.gray('暂无操作记录'));
    return;
  }

  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log(chalk.cyan('  操作记录'));
  console.log(chalk.cyan('═══════════════════════════════════════'));

  recent.forEach(l => {
    const actionColor = {
      login: chalk.green,
      config: chalk.blue,
      import: chalk.cyan,
      bind: chalk.magenta,
      batch: chalk.yellow,
      ship: chalk.green,
      receive: chalk.blue,
      verify: chalk.cyan,
      recall: chalk.red,
      diff: chalk.yellow,
      export: chalk.blue,
      mask: chalk.magenta,
      check: chalk.yellow,
      retry: chalk.red,
    }[l.action] || chalk.white;

    console.log(actionColor(`  [${l.action}]`.padEnd(14)) + chalk.white(l.detail));
    console.log(chalk.gray(`  ${l.timestamp}  ${l.id}`));
  });

  console.log(chalk.gray(`\n共 ${recent.length} 条记录` + (action ? ` (筛选: ${action})` : '')));
}

module.exports = log;
