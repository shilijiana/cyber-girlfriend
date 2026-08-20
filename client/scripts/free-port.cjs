/**
 * client/scripts/free-port.cjs —— 启动前自动释放指定端口（Windows）
 *
 * 用法：node free-port.cjs [port]    （缺省 5173）
 *
 * 背景：vite 默认端口被占用时自动顺延（5173→5174…），导致预览地址飘忽不定；
 * 后端 3000 若被残留进程占用，新起的后端会启动失败（麦克风/语音静默不可用）。
 * 此脚本在启动前杀掉占用指定端口的残留进程（通常是上次没退干净的服务），
 * 配合 vite.config.ts 的 strictPort: true，保证地址/端口恒定为预期值。
 *
 * 安全：只杀目标端口上 LISTENING 的进程；找不到占用/无权限时静默跳过，不阻塞启动。
 */

const { execSync } = require('node:child_process');

const PORT = process.argv[2] || '5173';

try {
  // netstat 找到目标端口上的监听进程
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
  const lines = out.split(/\r?\n/).filter((l) => l.includes('LISTENING'));
  for (const line of lines) {
    const pid = line.trim().split(/\s+/).pop();
    if (!pid || !/^\d+$/.test(pid)) continue;
    // 不杀自己（本脚本进程没有占用端口，保险起见仍做判断）
    if (pid === String(process.pid)) continue;
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`[free-port] 已释放 ${PORT} 端口（PID ${pid}，残留进程）`);
    } catch {
      console.log(`[free-port] 无法释放 ${PORT}（PID ${pid}），继续启动…`);
    }
  }
} catch {
  // 没有进程占用该端口，无需处理
}
