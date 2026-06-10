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
const auditReport = require('./commands/audit');
const compareReports = require('./commands/compare');
const archiveCmd = require('./commands/archive');

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
  .description('批量导入文件（码包/流向/批次），根据 --kind 自动识别：codepack/flow/batch（码包组）')
  .option('-n, --name <name>', '码包名称，默认取文件名（仅 codepack 生效）')
  .option('-k, --kind <kind>', '文件类型: codepack(码包) / flow(流向) / batch(批次)，默认自动识别', 'auto')
  .option('-d, --dry-run', '仅预览不写入，检查新增/跳过/错误数量')
  .option('--validate', '同 --dry-run，仅校验格式')
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
  .description('重试失败任务（核验组）- action: list/preview/run/export/clear')
  .option('--id <taskId>', '指定任务ID')
  .option('-t, --type <type>', '按任务类型筛选（import/ship/receive/verify 等）')
  .option('-s, --status <status>', '按状态筛选：pending/failed/done')
  .option('--from <date>', '创建时间起始 YYYY-MM-DD')
  .option('--to <date>', '创建时间结束 YYYY-MM-DD')
  .option('--export <file>', '重跑/列表后导出失败任务处理记录 JSON')
  .action(retryCmd);

program
  .command('export')
  .description('导出完整合规报告（报告组），支持批号/机构/日期筛选，包含缺失项、上下游差异、验码、召回')
  .option('-f, --format <format>', '导出格式: json/csv/txt', 'json')
  .option('-o, --output <file>', '输出文件路径')
  .option('--batch-no <batchNo>', '按批号筛选')
  .option('--org <org>', '按机构（发货方/收货方）筛选')
  .option('--from <date>', '按日期范围起始 YYYY-MM-DD')
  .option('--to <date>', '按日期范围结束 YYYY-MM-DD')
  .action(exportReport);

program
  .command('report <action>')
  .description('报告管理（报告组）- action: audit/export/compare')
  .option('-f, --file <file>', '待审计/导出的报告文件路径')
  .option('-a, --file-a <file>', '对比命令：报告A（基准/旧）')
  .option('-b, --file-b <file>', '对比命令：报告B（新/对比）')
  .option('-o, --output <file>', '导出报告时的输出路径')
  .option('--batch-no <batchNo>', '导出时按批号筛选')
  .option('--org <org>', '导出时按机构筛选')
  .option('--from <date>', '导出时起始日期')
  .option('--to <date>', '导出时结束日期')
  .option('-F, --format <format>', '导出格式 json/csv/txt')
  .action((action, options) => {
    if (action === 'audit') {
      auditReport(options.file);
    } else if (action === 'export') {
      exportReport(options);
    } else if (action === 'compare') {
      compareReports(options.fileA, options.fileB);
    } else {
      console.log(chalk.red(`未知 report 操作: ${action}`));
      console.log(chalk.gray('可用操作: audit / export / compare'));
    }
  });

program
  .command('report-compare')
  .description('对比两份 JSON 报告，查看批次/流向/缺失项/验码/召回变化（报告组）')
  .option('-a, --file-a <file>', '报告A（基准/旧）')
  .option('-b, --file-b <file>', '报告B（新/对比）')
  .action((options) => compareReports(options.fileA, options.fileB));

program
  .command('archive [action]')
  .description('归档查询（报告组）- action: list/show')
  .option('--id <archiveId>', 'show 时指定归档编号')
  .option('-t, --type <type>', '按类型筛选: export/audit/retry')
  .option('--from <date>', '创建时间起始 YYYY-MM-DD')
  .option('--to <date>', '创建时间结束 YYYY-MM-DD')
  .action((action, options) => {
    archiveCmd(action, options);
  });

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
  .command('help')
  .description('查看按 6 组分类的使用示例（账号/码包/批次/流向/核验/报告）')
  .action(() => {
    console.log(chalk.cyan('═══════════════════════════════════════════════════'));
    console.log(chalk.cyan('  药品追溯工具 durg-trace  使用示例'));
    console.log(chalk.cyan('═══════════════════════════════════════════════════'));
    console.log(chalk.gray('  用法: durg-trace <命令> [选项]'));
    console.log(chalk.gray('  输入 durg-trace --help 可查看所有命令参数'));
    console.log('');
    console.log(chalk.yellow('  ┌───────────────────────────────────────────────┐'));
    console.log(chalk.yellow('  │ 【账号组】login / config                       │'));
    console.log(chalk.yellow('  └───────────────────────────────────────────────┘'));
    console.log(chalk.white('    durg-trace login zhangsan -p 123456 -o 华北制药'));
    console.log(chalk.white('    durg-trace config list'));
    console.log(chalk.white('    durg-trace config set org 华北制药'));
    console.log(chalk.white('    durg-trace config set contact 张三'));
    console.log(chalk.white('    durg-trace config get org'));
    console.log('');
    console.log(chalk.yellow('  ┌───────────────────────────────────────────────┐'));
    console.log(chalk.yellow('  │ 【码包组】import / bind                         │'));
    console.log(chalk.yellow('  └───────────────────────────────────────────────┘'));
    console.log(chalk.white('    durg-trace import codes.txt -n 阿莫西林码包'));
    console.log(chalk.white('    durg-trace import codes.json --kind codepack'));
    console.log(chalk.white('    durg-trace import flow.csv --kind flow'));
    console.log(chalk.white('    durg-trace import batch.csv --kind batch'));
    console.log(chalk.white('    durg-trace import batch.csv --dry-run        # 预览不写入'));
    console.log(chalk.white('    durg-trace bind'));
    console.log(chalk.white('    durg-trace bind CPXXXX --product P001 --spec 0.25g --level box'));
    console.log('');
    console.log(chalk.yellow('  ┌───────────────────────────────────────────────┐'));
    console.log(chalk.yellow('  │ 【批次组】batch / check                         │'));
    console.log(chalk.yellow('  └───────────────────────────────────────────────┘'));
    console.log(chalk.white('    durg-trace batch register --batch-no BN2024001 --product 阿莫西林'));
    console.log(chalk.white('    durg-trace batch list'));
    console.log(chalk.white('    durg-trace batch detail --batch-no BN2024001'));
    console.log(chalk.white('    durg-trace check'));
    console.log('');
    console.log(chalk.yellow('  ┌───────────────────────────────────────────────┐'));
    console.log(chalk.yellow('  │ 【流向组】ship / receive / diff                 │'));
    console.log(chalk.yellow('  └───────────────────────────────────────────────┘'));
    console.log(chalk.white('    durg-trace ship --batch-no BN2024001 --from 华北制药 --to 北京医药 --quantity 1000'));
    console.log(chalk.white('    durg-trace receive --batch-no BN2024001'));
    console.log(chalk.white('    durg-trace receive --flow-id FLWXXXX --received-by 李经理'));
    console.log(chalk.white('    durg-trace diff'));
    console.log(chalk.white('    durg-trace diff --batch-no BN2024001'));
    console.log('');
    console.log(chalk.yellow('  ┌───────────────────────────────────────────────┐'));
    console.log(chalk.yellow('  │ 【核验组】verify / recall / retry               │'));
    console.log(chalk.yellow('  └───────────────────────────────────────────────┘'));
    console.log(chalk.white('    durg-trace verify --pack CPXXXX --count 10 --batch-no BN2024001'));
    console.log(chalk.white('    durg-trace recall --batch-no BN2024001 --reason 含量不达标'));
    console.log(chalk.white('    durg-trace recall --product 阿莫西林 --reason 包装瑕疵'));
    console.log(chalk.white('    durg-trace retry list'));
    console.log(chalk.white('    durg-trace retry list -t import -s pending'));
    console.log(chalk.white('    durg-trace retry preview                      # 重跑前预览影响'));
    console.log(chalk.white('    durg-trace retry run'));
    console.log(chalk.white('    durg-trace retry run --id RTYXXXX'));
    console.log(chalk.white('    durg-trace retry run --export retry-log.json  # 跑完导出留档'));
    console.log(chalk.white('    durg-trace retry clear'));
    console.log('');
    console.log(chalk.yellow('  ┌───────────────────────────────────────────────┐'));
    console.log(chalk.yellow('  │ 【报告组】export / report / mask / log          │'));
    console.log(chalk.yellow('  └───────────────────────────────────────────────┘'));
    console.log(chalk.white('    durg-trace export -f json -o report.json'));
    console.log(chalk.white('    durg-trace export -f csv --batch-no BN2024001'));
    console.log(chalk.white('    durg-trace export -f txt --from 2024-01-01 --to 2024-12-31'));
    console.log(chalk.white('    durg-trace export -f json --org 华北制药'));
    console.log(chalk.white('    durg-trace report audit -f report.json        # 审计已导出报告'));
    console.log(chalk.white('    durg-trace report audit -f report.txt'));
    console.log(chalk.white('    durg-trace report audit -f report.csv         # CSV/TXT 也能核对数字'));
    console.log(chalk.white('    durg-trace report compare -a old.json -b new.json  # 对比重导前后变化'));
    console.log(chalk.white('    durg-trace archive list                       # 查看所有归档编号'));
    console.log(chalk.white('    durg-trace archive list -t export --from 2024-01-01'));
    console.log(chalk.white('    durg-trace archive show --id ARC-20240610-XXXXX # 归档详情+关联追溯'));
    console.log(chalk.white('    durg-trace mask -t account'));
    console.log(chalk.white('    durg-trace mask -t all'));
    console.log(chalk.white('    durg-trace log -a ship -l 10'));
    console.log(chalk.white('    durg-trace log'));
    console.log('');
    console.log(chalk.gray('  说明: 所有操作产生的 JSON 数据存放在 data/ 目录下'));
    console.log(chalk.gray('  导入失败的任务可修好文件后执行 retry run 重新执行'));
  });

program
  .on('--help', () => {
    console.log('');
    console.log('  输入 durg-trace help 查看按 6 组分类的详细使用示例');
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
