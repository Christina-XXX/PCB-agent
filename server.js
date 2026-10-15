// server.js
import express from "express";
import cors from "cors";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { searchKnowledgeBase, webSearch } from "./rag/retrieve.js";

const app = express();
const PORT = process.env.PORT || 9100;
const __dirname = fileURLToPath(new URL(".", import.meta.url));

app.use(cors());
app.use(express.json());
// 同时托管前端，启动后直接访问 http://localhost:9100
app.use(express.static(join(__dirname, "web-ui")));

// PCB 缺陷分析专家的人设（追加到 Pi 默认系统提示之后）
const EXPERT_PROMPT = `
## 角色：PCB 缺陷分析专家
你是印制电路板（PCB）缺陷分析助手，负责根据资料定位用户描述的缺陷类型（标准名称）。
- 请基于下面提供的「参考资料」回答，不要编造资料里没有的内容。
- 回答时在相关内容后标注出处（如【来源：缺陷说明_clean.txt】或【来源：网络】）。
- 若资料来自联网搜索，注明「来源：网络，未经甲方资料核实」。
- 若知识库中暂无相关资料，请明确说明，再基于通用知识补充并注明。
- 直接、简洁、专业地给出结论，不要调用工具、不要写代码。
- 回答使用纯文本，不要使用 Markdown 标记（不要输出 # 标题、** 加粗等符号）。`;

// 组装检索到的资料 + 用户问题 → 交给 agent 的 prompt
function buildPrompt(question, kbHits, webHits) {
  const blocks = [];
  if (kbHits.length) {
    blocks.push(
      "## 参考资料（知识库）\n" +
        kbHits.map((h, i) => `[${i + 1}] ${h.text}\n（来源：${h.source}）`).join("\n\n"),
    );
  }
  if (webHits.length) {
    blocks.push(
      "## 参考资料（联网搜索，未经甲方资料核实）\n" +
        webHits
          .map((h, i) => `[${i + 1}] ${h.text}\n（来源：${h.url || h.title || "网络"}）`)
          .join("\n\n"),
    );
  }
  const ctx = blocks.length ? blocks.join("\n\n") : "（知识库中暂无相关资料）";
  return `${ctx}\n\n## 用户问题\n${question}`;
}

app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "消息不能为空" });

  try {
    // 1) 知识库检索
    let kbHits = [];
    try {
      kbHits = await searchKnowledgeBase(message);
    } catch (err) {
      console.warn("[chat] 知识库检索失败:", err.message);
    }

    // 2) 未命中 → 联网搜索（方案B）
    let webHits = [];
    let usedWeb = false;
    if (kbHits.length === 0) {
      try {
        webHits = await webSearch(message);
        usedWeb = webHits.length > 0;
      } catch (err) {
        console.warn("[chat] 联网搜索失败:", err.message);
      }
    }

    // 3) 组装 prompt 并交给 Pi agent
    const prompt = buildPrompt(message, kbHits, webHits);

    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      appendSystemPromptOverride: (base) => [...base, EXPERT_PROMPT],
    });
    await loader.reload();

    const { session } = await createAgentSession({
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });

    let replyText = "";
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        replyText += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(prompt);
    session.dispose();

    // 4) 返回回复 + 结构化出处
    const sources = [
      ...kbHits.map((h) => ({ text: h.text, source: h.source, type: "知识库" })),
      ...webHits.map((h) => ({ text: h.text, source: h.url || h.title || "网络", type: "网络" })),
    ];

    res.json({ reply: replyText, sources, usedWeb });
  } catch (error) {
    console.error("[chat] Agent 处理出错:", error);
    res.status(500).json({ error: "Agent 处理失败，请查看后端日志" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`后端服务已启动: http://0.0.0.0:${PORT}`);
});
