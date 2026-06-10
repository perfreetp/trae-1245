const chalk = require('chalk');
const store = require('../store');

function diff(options) {
  const flows = store.load('flow');
  const batchNo = options.batchNo || '';

  const shipRecords = flows.filter(f => f.type === 'ship' && (!batchNo || f.batchNo === batchNo));
  const receiveRecords = flows.filter(f => f.type === 'receive' && (!batchNo || f.batchNo === batchNo));

  if (shipRecords.length === 0) {
    console.log(chalk.yellow('暂无发货记录可供比对'));
    return;
  }

  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log(chalk.cyan('  上下游数据比对报告'));
  console.log(chalk.cyan('═══════════════════════════════════════'));

  const unmatched = [];
  const matched = [];

  shipRecords.forEach(ship => {
    const recv = receiveRecords.find(
      r => r.shipFlowId === ship.id || (r.batchNo === ship.batchNo && r.from === ship.from && r.to === ship.to)
    );
    if (recv) {
      matched.push({ ship, recv });
    } else {
      unmatched.push(ship);
    }
  });

  console.log(chalk.green(`\n✓ 已匹配: ${matched.length} 条`));
  matched.forEach(({ ship, recv }) => {
    console.log(chalk.white(`  ${ship.batchNo}  ${ship.from} → ${ship.to}  数量:${ship.quantity}  收货日期:${recv.date}`));
  });

  console.log(chalk.red(`\n✗ 未匹配: ${unmatched.length} 条`));
  unmatched.forEach(ship => {
    console.log(chalk.white(`  ${ship.batchNo}  ${ship.from} → ${ship.to}  数量:${ship.quantity}  状态:${ship.status}`));
  });

  const quantityMismatches = matched.filter(({ ship, recv }) => ship.quantity !== recv.quantity);
  if (quantityMismatches.length > 0) {
    console.log(chalk.yellow(`\n⚠ 数量不一致: ${quantityMismatches.length} 条`));
    quantityMismatches.forEach(({ ship, recv }) => {
      console.log(chalk.white(`  ${ship.batchNo}  发货:${ship.quantity}  收货:${recv.quantity}`));
    });
  }

  if (batchNo) {
    console.log(chalk.gray(`\n筛选批号: ${batchNo}`));
  }
  console.log(chalk.gray(`比对时间: ${new Date().toISOString()}`));
}

module.exports = diff;
