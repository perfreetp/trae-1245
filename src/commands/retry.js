const chalk = require('chalk');
const store = require('../store');

function retryCmd(action, options) {
  const retries = store.load('retry');

  if (action === 'list' || !action) {
    const pending = retries.filter(r => r.status === 'pending');
    if (pending.length === 0) {
      console.log(chalk.green('✓ 无待重试任务'));
      return;
    }
    console.log(chalk.cyan('待重试任务列表:'));
    pending.forEach(r => {
      console.log(chalk.white(`  ${r.id}  类型:${r.taskType}  错误:${r.errorMsg}  创建:${r.createdAt}`));
    });
    return;
  }

  if (action === 'run') {
    const taskId = options.id || '';
    const pending = retries.filter(r => r.status === 'pending');

    if (pending.length === 0) {
      console.log(chalk.green('✓ 无待重试任务'));
      return;
    }

    let targets = pending;
    if (taskId) {
      targets = pending.filter(r => r.id === taskId);
      if (targets.length === 0) {
        console.log(chalk.red(`错误: 任务 ${taskId} 不存在或已完成`));
        return;
      }
    }

    console.log(chalk.cyan(`正在重试 ${targets.length} 个任务...`));

    targets.forEach(t => {
      t.retryCount += 1;
      t.lastRetryAt = new Date().toISOString();

      const shouldSucceed = Math.random() > 0.2;
      if (shouldSucceed) {
        t.status = 'completed';
        t.completedAt = new Date().toISOString();
        console.log(chalk.green(`  ✓ ${t.id} 重试成功 (${t.taskType})`));
      } else {
        t.errorMsg = '重试仍失败，请检查数据';
        console.log(chalk.yellow(`  ✗ ${t.id} 重试失败 (${t.taskType})`));
        if (t.retryCount >= 3) {
          t.status = 'failed';
          console.log(chalk.red(`    已达最大重试次数，标记为失败`));
        }
      }
    });

    store.save('retry', retries);
    store.addLog('retry', `重试 ${targets.length} 个任务`);

    const completed = targets.filter(t => t.status === 'completed').length;
    const failed = targets.filter(t => t.status !== 'completed').length;
    console.log(chalk.white(`\n结果: ${completed} 成功, ${failed} 失败`));
    return;
  }

  if (action === 'clear') {
    const remaining = retries.filter(r => r.status === 'pending' || r.status === 'failed');
    if (remaining.length === retries.length) {
      console.log(chalk.gray('无已完成任务需要清理'));
      return;
    }
    store.save('retry', remaining);
    store.addLog('retry', `清理已完成任务 ${retries.length - remaining.length} 条`);
    console.log(chalk.green(`✓ 已清理 ${retries.length - remaining.length} 条完成任务`));
    return;
  }

  console.log(chalk.red(`未知操作: ${action}`));
  console.log(chalk.gray('可用操作: list, run, clear'));
}

module.exports = retryCmd;
