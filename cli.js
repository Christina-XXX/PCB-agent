// cli.js —— PCB 缺陷分析终端交互程序
// 用法：node --env-file=.env cli.js
import readline from "node:readline";
import process from "node:process";
import { askPCB } from "./rag/ask.js";

// ---------- 终端着色（非 TTY 时自动关闭，保证日志/管道输出干净） ----------
const useColor = process.stdout.isTTY;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const green = paint("32");
const cyan = paint("36");
const yellow = paint("33");
const red = paint("31");
const gray = paint("90");

const PROMPT = green("❯ ");

function printBanner() {
  console.log(bold("PCB 缺陷分析助手") + gray(" —— 知识库 + 联网检索"));
  console.log(gray("直接输入缺陷现象，回车发送。命令：help / clear / exit；Ctrl+C 退出。"));
  console.log("");
}

function printHelp() {
  console.log(
    [
      "",
      "可用命令：",
      "  help     显示本帮助",
      "  clear    清空屏幕",
      "  exit     退出程序",
      "",
      "用法示例（直接输入缺陷现象即可）：",
      "  光学点到光学点不合格，实测偏大",
      "",
    ].join("\n"),
  );
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

// 打印结构化出处（知识库 / 网络）
function printSources(sources) {
  if (!sources.length) return;
  console.log(gray("\n依据："));
  for (const [i, s] of sources.entries()) {
    const tag =
      s.type === "知识库" ? green(`[${i + 1}] 知识库`) : yellow(`[${i + 1}] 网络`);
    console.log(`  ${tag} · ${s.source}`);
    if (s.text) {
      const flat = s.text.replace(/\s+/g, " ").trim();
      const snippet = flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
      console.log(gray(`      ${snippet}`));
    }
  }
}

// ---------- 交互式 REPL ----------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: PROMPT,
  terminal: true,
});

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  const cmd = input.toLowerCase();
  if (cmd === "exit" || cmd === "quit") {
    rl.close();
    return;
  }
  if (cmd === "help" || cmd === "?" || cmd === "？") {
    printHelp();
    rl.prompt();
    return;
  }
  if (cmd === "clear" || cmd === "cls") {
    clearScreen();
    printBanner();
    rl.prompt();
    return;
  }

  // 流式作答期间暂停读入，避免键入字符干扰输出
  rl.pause();
  try {
    const { sources } = await askPCB(input, (delta) => process.stdout.write(delta));
    process.stdout.write("\n");
    printSources(sources);
    process.stdout.write("\n");
  } catch (err) {
    console.error(red(`\n出错：${err.message}`));
    console.error(gray("请确认已配置 .env 且 RAGFlow 服务可达。"));
  } finally {
    rl.resume();
    rl.prompt();
  }
});

rl.on("SIGINT", () => rl.close());

rl.on("close", () => {
  console.log(gray("\n已退出。"));
  process.exit(0);
});

printBanner();
rl.prompt();
