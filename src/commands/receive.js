const chalk = require('chalk');
const store = require('../store');

function receive(options) {
  const flows = store.load('flow');

  const flowId = options.flowId || '';
  const batchNo = options.batchNo || '';
  const receivedBy = options.receivedBy || '';
  const date = options.date || new Date().toISOString().split('T')[0];

  let flow;
  if (flowId) {
    flow = flows.find(f => f.id === flowId);
  } else if (batchNo) {
    flow = flows
      .filter(f => f.type === 'ship' && f.batchNo === batchNo && f.status === 'reported')
      .pop();
  }

  if (!flow) {
    console.log(chalk.red('错误: 未找到待收货的发货记录，请提供 --flow-id 或 --batch-no'));
    return;
  }

  if (flow.status === 'received') {
    console.log(chalk.yellow('警告: 该发货记录已确认收货'));
    return;
  }

  const receiveRecord = {
    id: 'RCV' + Date.now().toString(36).toUpperCase(),
    type: 'receive',
    shipFlowId: flow.id,
    batchNo: flow.batchNo,
    from: flow.from,
    to: flow.to,
    quantity: flow.quantity,
    receivedBy: receivedBy || flow.to,
    date,
    createdAt: new Date().toISOString(),
  };

  flow.status = 'received';
  flow.receivedAt = new Date().toISOString();

  flows.push(receiveRecord);
  store.save('flow', flows);
  store.addLog('receive', `确认收货: ${flow.batchNo}, ${flow.from} → ${flow.to}`);

  console.log(chalk.green('✓ 收货确认成功'));
  console.log(chalk.white(`  收货ID: ${receiveRecord.id}`));
  console.log(chalk.white(`  批号: ${flow.batchNo}`));
  console.log(chalk.white(`  发货方: ${flow.from}`));
  console.log(chalk.white(`  收货方: ${receivedBy || flow.to}`));
  console.log(chalk.white(`  数量: ${flow.quantity}`));
  console.log(chalk.white(`  收货日期: ${date}`));
}

module.exports = receive;
