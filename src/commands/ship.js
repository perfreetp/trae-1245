const chalk = require('chalk');
const store = require('../store');

function ship(options) {
  const flows = store.load('flow');
  const batches = store.load('batch');

  const batchNo = options.batchNo || '';
  const from = options.from || '';
  const to = options.to || '';
  const quantity = parseInt(options.quantity) || 0;
  const date = options.date || new Date().toISOString().split('T')[0];

  if (!batchNo || !from || !to) {
    console.log(chalk.red('错误: 请提供 --batch-no, --from, --to 参数'));
    return;
  }

  if (quantity <= 0) {
    console.log(chalk.red('错误: 请提供有效的 --quantity 参数'));
    return;
  }

  const batch = batches.find(b => b.batchNo === batchNo);
  if (!batch) {
    console.log(chalk.yellow(`警告: 批号 ${batchNo} 未在系统中登记`));
  }

  const flow = {
    id: 'FLW' + Date.now().toString(36).toUpperCase(),
    type: 'ship',
    batchNo,
    from,
    to,
    quantity,
    date,
    status: 'reported',
    createdAt: new Date().toISOString(),
  };

  flows.push(flow);
  store.save('flow', flows);
  store.addLog('ship', `上报发货: ${batchNo}, ${from} → ${to}, 数量 ${quantity}`);

  console.log(chalk.green('✓ 发货上报成功'));
  console.log(chalk.white(`  流向ID: ${flow.id}`));
  console.log(chalk.white(`  批号: ${batchNo}`));
  console.log(chalk.white(`  发货方: ${from}`));
  console.log(chalk.white(`  收货方: ${to}`));
  console.log(chalk.white(`  数量: ${quantity}`));
  console.log(chalk.white(`  日期: ${date}`));
}

module.exports = ship;
