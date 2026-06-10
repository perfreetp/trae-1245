const chalk = require('chalk');
const store = require('../store');

function batch(action, options) {
  const batches = store.load('batch');
  const codepacks = store.load('codepack');

  if (action === 'register' || action === 'add' || !action) {
    const packId = options.pack || '';
    const batchNo = options.batchNo || '';
    const product = options.product || '';
    const prodDate = options.prodDate || '';
    const expiry = options.expiry || '';

    if (!batchNo) {
      console.log(chalk.red('错误: 请提供批号 --batch-no'));
      return;
    }

    if (packId) {
      const pack = codepacks.find(p => p.id === packId || p.name === packId);
      if (!pack) {
        console.log(chalk.red(`错误: 码包 ${packId} 不存在`));
        return;
      }
      if (!pack.bound) {
        console.log(chalk.yellow('警告: 码包尚未绑定，建议先执行 bind 命令'));
      }
    }

    const existing = batches.find(b => b.batchNo === batchNo);
    if (existing) {
      console.log(chalk.yellow(`警告: 批号 ${batchNo} 已存在`));
      return;
    }

    const batch = {
      id: 'BAT' + Date.now().toString(36).toUpperCase(),
      batchNo,
      packId: packId || '',
      product,
      prodDate,
      expiry,
      status: 'registered',
      createdAt: new Date().toISOString(),
    };

    batches.push(batch);
    store.save('batch', batches);
    store.addLog('batch', `登记批次 ${batchNo}, 产品 ${product || '未指定'}`);

    console.log(chalk.green(`✓ 批次登记成功`));
    console.log(chalk.white(`  批号: ${batchNo}`));
    console.log(chalk.white(`  批次ID: ${batch.id}`));
    console.log(chalk.white(`  关联码包: ${packId || '未关联'}`));
    console.log(chalk.white(`  产品: ${product || '未指定'}`));
    console.log(chalk.white(`  生产日期: ${prodDate || '未指定'}`));
    console.log(chalk.white(`  有效期至: ${expiry || '未指定'}`));
    return;
  }

  if (action === 'list') {
    if (batches.length === 0) {
      console.log(chalk.gray('暂无批次记录'));
      return;
    }
    console.log(chalk.cyan('批次列表:'));
    batches.forEach(b => {
      console.log(chalk.white(`  ${b.batchNo}  产品: ${b.product || '-'}  状态: ${b.status}  创建: ${b.createdAt}`));
    });
    return;
  }

  if (action === 'detail') {
    const batchNo = options.batchNo || '';
    if (!batchNo) {
      console.log(chalk.red('错误: 请提供批号 --batch-no'));
      return;
    }
    const batch = batches.find(b => b.batchNo === batchNo);
    if (!batch) {
      console.log(chalk.red(`错误: 批号 ${batchNo} 不存在`));
      return;
    }
    console.log(chalk.cyan('批次详情:'));
    Object.entries(batch).forEach(([k, v]) => {
      console.log(chalk.white(`  ${k}: ${v}`));
    });
    return;
  }

  console.log(chalk.red(`未知操作: ${action}`));
  console.log(chalk.gray('可用操作: register, list, detail'));
}

module.exports = batch;
