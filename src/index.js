#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');

const login = require('./commands/login');
const config = require('./commands/config');
const importCodes = require('./commands/import');
const bind = require('./commands/bind');
const batch = require('./commands/batch');
const ship = require('./commands/ship');
const receive = require('./commands/receive');
const diff = require('./commands/diff');
const verify = require('./commands/verify');
const recall = require('./commands/recall');
const retryCmd = require('./commands/retry');
const exportReport = require('./commands/export');
const mask = require('./commands/mask');
const logCmd = require('./commands/log');
const check = require('./commands/check');

const program = new Command();

program
  .name('durg-trace')
  .description('药品追溯命令行工具 - 供药企合规人员批量处理追溯码和流向文件')
  .version('1.0.0');

program
  .command('login <username>')
  .description('登录系统（账号组）')
  .option('-p, --password <password>', '密码')
  .option('-o, --org <org>', '所属机构名称')
  .action(login);

program
  .command('config [action] [key]')
  .description('管理机构信息（账号组）- action: set/get/list')
  .option('-v, --value <value>', '配置值（配合 set 使用）')
  .action(config);

program
  .command('import <file>')
  .description('导入码包文件，支持 txt/csv/json 格式（码包组）')
  .option('-n, --name <name>', '码包名称，默认取文件名')
  .action(importCodes);

program
  .command('bind [packId]')
  .description('绑定码包到产品包装（码包组），不带参数查看未绑定列表')
  .option('--product <productId>', '产品ID')
  .option('--spec <spec>', '规格')
  .option('--level <level>', '包装级别: min/box/carton/pallet', 'min')
  .action(bind);

program
  .command('batch [action]')
  .description('登记批次（批次组）- action: register/list/detail')
  .option('--batch-no <batchNo>', '批号')
  .option('--pack <packId>', '关联码包ID')
  .option('--product <product>', '产品名称')
  .option('--prod-date <date>', '生产日期')
  .option('--expiry <date>', '有效期至')
  .action(batch);

program
  .command('ship')
  .description('上报发货信息（流向组）')
  .option('--batch-no <batchNo>', '批号')
  .option('--from <from>', '发货方')
  .option('--to <to>', '收货方')
  .option('--quantity <quantity>', '数量')
  .option('--date <date>', '发货日期')
  .action(ship);

program
  .command('receive')
  .description('确认收货（流向组）')
  .option('--flow-id <flowId>', '发货流向ID')
  .option('--batch-no <batchNo>', '批号（自动匹配待收货记录）')
  .option('--received-by <who>', '收货人')
  .option('--date <date>', '收货日期')
  .action(receive);

program
  .command('diff')
  .description('比对上下游数据（流向组）')
  .option('--batch-no <batchNo>', '筛选指定批号')
  .action(diff);

program
  .command('verify')
  .description('抽样验码（核验组）')
  .option('--pack <packId>', '指定码包')
  .option('--batch-no <batchNo>', '关联批号')
  .option('--count <count>', '抽样数量', '5')
  .action(verify);

program
  .command('recall')
  .description('生成召回清单（核验组）')
  .option('--batch-no <batchNo>', '指定批号')
  .option('--product <product>', '按产品筛选')
  .option('--reason <reason>', '召回原因', '质量问题')
  .action(recall);

program
  .command('retry [action]')
  .description('重试失败任务（核验组）- action: list/run/clear')
  .option('--id <taskId>', '指定任务ID')
  .action(retryCmd);

program
  .command('export')
  .description('导出报告（报告组）')
  .option('-f, --format <format>', '导出格式: json/csv/txt', 'json')
  .option('-t, --type <type>', '数据类型: all/account/codepack/batch/flow/verify/report', 'all')
  .option('-o, --output <file>', '输出文件路径')
  .action(exportReport);

program
  .command('mask')
  .description('脱敏输出数据（报告组）')
  .option('-t, --type <type>', '数据类型: all/account/codepack/flow/batch/verify', 'all')
  .action(mask);

program
  .command('log')
  .description('查看操作记录（报告组）')
  .option('-a, --action <action>', '筛选操作类型')
  .option('-l, --limit <limit>', '显示条数', '20')
  .action(logCmd);

program
  .command('check')
  .description('检查合规缺失项（批次组）')
  .action(check);

program
  .command('help-examples')
  .description('查看使用示例')
  .action(() => {
    console.log(chalk.cyan('═══════════════════════════════════════════════════'));
    console.log(chalk.cyan('  药品追溯工具 - 使用示例'));
    console.log(chalk.cyan('═══════════════════════════════════════════════════'));
    console.log('');
    console.log(chalk.yellow('  【账号组】'));
    console.log(chalk.white('  durg-trace login zhangsan -p 123456 -o 华北制药'));
    console.log(chalk.white('  durg-trace config set org 华北制药'));
    console.log(chalk.white('  durg-trace config get org'));
    console.log(chalk.white('  durg-trace config list'));
    console.log('');
    console.log(chalk.yellow('  【码包组】'));
    console.log(chalk.white('  durg-trace import codes.txt -n 阿莫西林码包'));
    console.log(chalk.white('  durg-trace import codes.json'));
    console.log(chalk.white('  durg-trace bind CPXXXX --product P001 --spec 0.25g --level box'));
    console.log('');
    console.log(chalk.yellow('  【批次组】'));
    console.log(chalk.white('  durg-trace batch register --batch-no BN2024001 --product 阿莫西林'));
    console.log(chalk.white('  durg-trace batch list'));
    console.log(chalk.white('  durg-trace check'));
    console.log('');
    console.log(chalk.yellow('  【流向组】'));
    console.log(chalk.white('  durg-trace ship --batch-no BN2024001 --from 华北制药 --to 北京医药 --quantity 1000'));
    console.log(chalk.white('  durg-trace receive --batch-no BN2024001'));
    console.log(chalk.white('  durg-trace diff'));
    console.log(chalk.white('  durg-trace diff --batch-no BN2024001'));
    console.log('');
    console.log(chalk.yellow('  【核验组】'));
    console.log(chalk.white('  durg-trace verify --pack CPXXXX --count 10'));
    console.log(chalk.white('  durg-trace recall --batch-no BN2024001 --reason 含量不达标'));
    console.log(chalk.white('  durg-trace retry list'));
    console.log(chalk.white('  durg-trace retry run'));
    console.log('');
    console.log(chalk.yellow('  【报告组】'));
    console.log(chalk.white('  durg-trace export -f json -o report.json'));
    console.log(chalk.white('  durg-trace export -f csv -t flow'));
    console.log(chalk.white('  durg-trace mask -t account'));
    console.log(chalk.white('  durg-trace log -a ship -l 10'));
    console.log('');
    console.log(chalk.gray('  数据分组: 账号(login/config) 码包(import/bind) 批次(batch/check)'));
    console.log(chalk.gray('           流向(ship/receive/diff) 核验(verify/recall/retry) 报告(export/mask/log)'));
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
