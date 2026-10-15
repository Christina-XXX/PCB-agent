// RAG 检索抽象层
// 对外统一提供两个能力：
//   1) searchKnowledgeBase(query) —— 知识库检索（后端现在是 RAGFlow，未部署时回退到本地文本匹配）
//   2) webSearch(query)            —— 联网搜索（Tavily / DuckDuckGo）
// 以后要换成自研 RAG，只需重写 searchKnowledgeBase 内部实现，server.js 无需改动。

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- 配置（优先读环境变量，见 agent/.env.example） ----------
const RAGFLOW_BASE_URL = process.env.RAGFLOW_BASE_URL || "http://localhost:80";
const RAGFLOW_API_KEY = process.env.RAGFLOW_API_KEY || "";
const RAGFLOW_DATASET_IDS = (process.env.RAGFLOW_DATASET_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 检索相似度阈值：低于此值的片段视为无关，过滤掉（0.35 为实测后的平衡点：
// 正确匹配普遍 ≥0.43，无关片段普遍 ≤0.32）
const SIMILARITY_THRESHOLD = 0.35;

const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || "duckduckgo").toLowerCase(); // tavily | duckduckgo
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// 本地「分析资料」目录，用于无 RAGFlow 时的文本匹配兜底
const LOCAL_KB_DIR =
  process.env.LOCAL_KB_DIR || fileURLToPath(new URL("../../分析资料", import.meta.url));

/**
 * 知识库检索。统一返回 [{ text, source }]。
 * - 配置了 RAGFLOW_DATASET_IDS 时调用 RAGFlow 检索接口；
 * - 否则回退到本地「分析资料」目录的简单文本匹配（仅供无 RAGFlow 时演示）。
 */
export async function searchKnowledgeBase(query) {
  if (RAGFLOW_DATASET_IDS.length > 0) {
    try {
      return await searchRagflow(query);
    } catch (err) {
      console.warn("[RAG] RAGFlow 检索失败，回退本地匹配:", err.message);
    }
  }
  return searchLocal(query);
}

// ---------- RAGFlow 检索 ----------
async function searchRagflow(query) {
  // 注意：RAGFlow 检索接口会随版本变化；部署后按你所用版本的 API 调整此处路径与字段。
  const res = await fetch(`${RAGFLOW_BASE_URL}/api/v1/retrieval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(RAGFLOW_API_KEY ? { Authorization: `Bearer ${RAGFLOW_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      question: query,
      dataset_ids: RAGFLOW_DATASET_IDS,
    }),
  });
  if (!res.ok) throw new Error(`RAGFlow HTTP ${res.status}`);
  const data = await res.json();
  const chunks = data?.data?.chunks ?? [];
  // 先按相似度阈值过滤无关片段，再取前 2 条
  return chunks
    .filter((c) => (c.similarity ?? 0) >= SIMILARITY_THRESHOLD)
    .slice(0, 2)
    .map((c) => ({
    text: c.content || c.content_with_weight || "",
    source: c.document_keyword || c.document_name || c.doc_name || "知识库",
  }));
}

// ---------- 本地文本匹配（兜底） ----------
async function searchLocal(query) {
  try {
    const files = (await readdir(LOCAL_KB_DIR)).filter((f) => f.endsWith(".txt"));
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const hits = [];
    for (const f of files) {
      const content = await readFile(join(LOCAL_KB_DIR, f), "utf-8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        const score = terms.reduce((s, t) => (line.includes(t) ? s + 1 : s), 0);
        if (score > 0) hits.push({ text: line.trim(), source: f, score });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, 5).map(({ text, source }) => ({ text, source }));
  } catch (err) {
    console.warn("[RAG] 本地匹配失败:", err.message);
    return [];
  }
}

// ---------- 联网搜索 ----------
export async function webSearch(query) {
  if (SEARCH_PROVIDER === "tavily" && TAVILY_API_KEY) return searchTavily(query);
  return searchDuckDuckGo(query);
}

async function searchTavily(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title || "",
    text: r.content || "",
    url: r.url || "",
  }));
}

async function searchDuckDuckGo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const data = await res.json();
  const results = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading || "摘要", text: data.AbstractText, url: data.AbstractURL || "" });
  }
  for (const t of data.RelatedTopics || []) {
    if (t.Text) results.push({ title: t.Text.split(" - ")[0] || "相关内容", text: t.Text, url: t.FirstURL || "" });
  }
  return results.slice(0, 5);
}

// 简单分词：中文按 2 字以上连续段切，英文/数字按 2 字符以上词切
function tokenize(text) {
  return (text.match(/[一-龥]{2,}|[a-zA-Z0-9]{2,}/g) || []).map((t) => t.toLowerCase());
}
