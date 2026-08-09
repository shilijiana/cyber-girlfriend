#!/usr/bin/env node
/**
 * 测试报告聚合脚本（DESIGN §11.5）
 * 读取 Vitest JSON / Playwright JSON / coverage-summary.json，
 * 生成 test-summary.md：总通过率、失败用例详情（文件+行+报错摘要）、覆盖率统计。
 * 用法：npm run report
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const VITEST_JSON = join(root, 'test-results', 'vitest-results.json');
const PLAYWRIGHT_JSON = join(root, 'test-results', 'playwright-results.json');
const COVERAGE_SUMMARY = join(root, 'coverage', 'coverage-summary.json');
const OUT = join(root, 'test-summary.md');

function readJson(p) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch (err) {
    console.warn(`[report] 读取 ${p} 失败: ${err.message}`);
    return null;
  }
}

function formatPct(pct) {
  return `${pct.toFixed(2)}%`;
}

function collectVitest(vitest) {
  if (!vitest) return { section: '', passed: 0, total: 0, failures: [] };
  const total = vitest.numTotalTests ?? 0;
  const passed = vitest.numPassedTests ?? 0;
  const failed = vitest.numFailedTests ?? 0;
  const failedSuites = vitest.numFailedTestSuites ?? 0;
  const failures = [];
  for (const suite of vitest.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        failures.push({
          file: suite.name,
          name: assertion.name,
          messages: (assertion.failureMessages ?? []).slice(0, 2),
        });
      }
    }
  }
  const rate = total > 0 ? ((passed / total) * 100).toFixed(2) : 'N/A';
  const lines = [
    `### Vitest（单元 + 集成）`,
    ``,
    `- 通过率：**${rate}%**（${passed}/${total}）`,
    `- 失败：${failed} 个用例，失败套件：${failedSuites} 个`,
  ];
  if (failures.length > 0) {
    lines.push(``, `**失败用例详情：**`);
    for (const f of failures) {
      lines.push(`- \`${f.file}\` → ${f.name}`);
      for (const m of f.messages) {
        const brief = m.split('\n').slice(0, 3).join(' | ').slice(0, 300);
        lines.push(`  - ${brief}`);
      }
    }
  }
  return { section: lines.join('\n'), passed, total, failures };
}

function collectPlaywright(pw) {
  if (!pw) return { section: '', passed: 0, total: 0, failures: [] };
  const stats = pw.stats ?? {};
  const total = stats.total ?? 0;
  const passed = stats.expected ?? 0;
  const failures = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (!t.ok) {
          const err = t.results?.[0]?.error;
          failures.push({
            file: spec.title,
            name: `${suite.title} › ${spec.title}`,
            messages: err ? [err.message ?? String(err)] : [],
          });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of pw.suites ?? []) walk(s);
  const rate = total > 0 ? ((passed / total) * 100).toFixed(2) : 'N/A';
  const lines = [
    `### Playwright（E2E）`,
    ``,
    `- 通过率：**${rate}%**（${passed}/${total}）`,
    `- 意外失败：${stats.unexpected ?? 0}，flaky：${stats.flaky ?? 0}`,
  ];
  if (failures.length > 0) {
    lines.push(``, `**失败用例详情：**`);
    for (const f of failures) {
      lines.push(`- \`${f.file}\` → ${f.name}`);
      for (const m of f.messages) {
        lines.push(`  - ${m.slice(0, 300)}`);
      }
    }
  }
  return { section: lines.join('\n'), passed, total, failures };
}

function collectCoverage(cov) {
  if (!cov || !cov.total) return { section: '' };
  const t = cov.total;
  const fmt = (k) => {
    const v = t[k];
    return v ? `${v.percent.toFixed(2)}%（${v.covered}/${v.total}）` : 'N/A';
  };
  return {
    section: [
      `### 覆盖率统计（v8）`,
      ``,
      `| 指标 | 覆盖率 |`,
      `|------|--------|`,
      `| 行（lines） | ${fmt('lines')} |`,
      `| 语句（statements） | ${fmt('statements')} |`,
      `| 函数（functions） | ${fmt('functions')} |`,
      `| 分支（branches） | ${fmt('branches')} |`,
      ``,
      `> 明细见 coverage/index.html`,
    ].join('\n'),
  };
}

const vitest = collectVitest(readJson(VITEST_JSON));
const pw = collectPlaywright(readJson(PLAYWRIGHT_JSON));
const cov = collectCoverage(readJson(COVERAGE_SUMMARY));

const grandTotal = vitest.total + pw.total;
const grandPassed = vitest.passed + pw.passed;
const grandRate = grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(2) : 'N/A';

const md = [
  `# 测试报告（${new Date().toISOString().slice(0, 19).replace('T', ' ')}）`,
  ``,
  `## 总览`,
  ``,
  `- 总通过率：**${grandRate}%**（${grandPassed}/${grandTotal}）`,
  `- Vitest 失败用例：${vitest.failures.length}，Playwright 失败用例：${pw.failures.length}`,
  ``,
  vitest.section,
  ``,
  pw.section,
  ``,
  cov.section,
  ``,
  `---`,
  `*由 scripts/aggregate-report.mjs 自动生成*`,
  ``,
].join('\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md, 'utf8');
console.log(md);
console.log(`\n[report] 已生成 ${OUT}`);
