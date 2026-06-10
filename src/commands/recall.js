const chalk = require('chalk');
const store = require('../store');

function recall(options) {
  const batchNo = options.batchNo || '';
  const product = options.product || '';
  const reason = options.reason || '质量问题';

  const flows = store.load('flow');
  const batches = store.load('batch');

  let targetBatches = batches;
  if (batchNo) {
    targetBatches = batches.filter(b => b.batchNo === batchNo);
  } else if (product) {
    targetBatches = batches.filter(b => b.product === product);
  }

  if (targetBatches.length === 0) {
    console.log(chalk.yellow('未找到匹配的批次记录'));
    return;
  }

  console.log(chalk.red('═══════════════════════════════════════'));
  console.log(chalk.red('  药品召回清单'));
  console.log(chalk.red('═══════════════════════════════════════'));
  console.log(chalk.white(`  召回原因: ${reason}`));
  console.log(chalk.white(`  生成时间: ${new Date().toISOString()}`));
  console.log('');

  const recallList = [];

  targetBatches.forEach(batch => {
    const relatedFlows = flows.filter(f => f.batchNo === batch.batchNo);
    const shipFlows = relatedFlows.filter(f => f.type === 'ship');
    const receiveFlows = relatedFlows.filter(f => f.type === 'receive');

    console.log(chalk.cyan(`  批号: ${batch.batchNo}`));
    console.log(chalk.white(`    产品: ${batch.product || '-'}`));
    console.log(chalk.white(`    生产日期: ${batch.prodDate || '-'}`));
    console.log(chalk.white(`    有效期至: ${batch.expiry || '-'}`));
    console.log(chalk.white(`    发货记录: ${shipFlows.length} 条`));
    console.log(chalk.white(`    收货记录: ${receiveFlows.length} 条`));

    if (shipFlows.length > 0) {
      console.log(chalk.gray('    流向明细:'));
      shipFlows.forEach(f => {
        const recv = receiveFlows.find(r => r.shipFlowId === f.id);
        const status = recv ? '已收货' : f.status;
        console.log(chalk.gray(`      ${f.from} → ${f.to}  数量:${f.quantity}  状态:${status}`));
      });
    }

    recallList.push({
      batchNo: batch.batchNo,
      product: batch.product,
      reason,
      flows: shipFlows.map(f => ({
        from: f.from,
        to: f.to,
        quantity: f.quantity,
        status: f.status,
      })),
    });

    console.log('');
  });

  const reports = store.load('report');
  reports.push({
    id: 'RCL' + Date.now().toString(36).toUpperCase(),
    type: 'recall',
    batchNo,
    product,
    reason,
    recallList,
    createdAt: new Date().toISOString(),
  });
  store.save('report', reports);
  store.addLog('recall', `生成召回清单: ${targetBatches.length} 个批次, 原因: ${reason}`);

  console.log(chalk.green(`✓ 召回清单已生成，共 ${targetBatches.length} 个批次`));
  console.log(chalk.gray(`  报告ID: RCL${Date.now().toString(36).toUpperCase()}`));
}

module.exports = recall;
