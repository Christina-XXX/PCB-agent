// test/terminology-chaos.mjs
// 术语混乱测试 —— 验证系统把「非标准说法 / 口语 / 术语混用」正确归到标准缺陷类型
//
// 运行（在项目根目录、Windows 终端）：
//   node --env-file=.env test/terminology-chaos.mjs           仅检索层（快，无大模型成本）
//   node --env-file=.env test/terminology-chaos.mjs --full    端到端（检索 + 大模型作答）
//   node --env-file=.env test/terminology-chaos.mjs 线路      只跑含「线路」的用例
//
// 判定标准：
//   - 检索层：命中的文档名是否包含预期标准缺陷类别（expectSource）
//   - 端到端：出处是否正确（同上）+ 回答中是否出现预期标准术语（expectTerms）

const RAGFLOW_BASE_URL = process.env.RAGFLOW_BASE_URL || "http://localhost:80";
const RAGFLOW_API_KEY = process.env.RAGFLOW_API_KEY || "";
const RAGFLOW_DATASET_IDS = (process.env.RAGFLOW_DATASET_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SIMILARITY_THRESHOLD = 0.35; // 与 rag/retrieve.js 保持一致
const TOP_K = 2;

const mode = process.argv.includes("--full") ? "full" : "retrieval";
const filter = process.argv
  .slice(2)
  .filter((a) => a !== "--full" && a !== "--retrieval");

// ===== 测试用例 =====
// q           : 非标准 / 口语 / 混用的说法
// expectSource: 预期命中的标准缺陷文档（文件名关键词，可多个，命中任意一个即通过）
// expectTerms : 回答中应出现的标准术语（端到端模式使用，命中任意一个即通过）
// ambiguous   : 模糊描述用例，仅观察、不参与打分
const cases = [
  // —— 线路 ——
  { q: "板子上有根线断了", expectSource: "线路", expectTerms: ["开路", "线路"] },
  { q: "两条线路碰在一起了", expectSource: "线路", expectTerms: ["短路", "线路"] },
  { q: "铜箔从基材上翘起来了", expectSource: "线路", expectTerms: ["剥离", "线路"] },
  { q: "走线变细了，跟原稿对不上", expectSource: "线路", expectTerms: ["线宽", "线路"] },

  // —— 阻焊（俗称绿油 / 绿漆 / 防焊）——
  { q: "绿油没有盖住焊盘", expectSource: "阻焊", expectTerms: ["阻焊", "绿油"] },
  { q: "绿漆有残留没清干净", expectSource: "阻焊", expectTerms: ["阻焊", "绿油"] },
  { q: "防焊层起泡了", expectSource: "阻焊", expectTerms: ["阻焊"] },

  // —— 孔 ——
  { q: "过孔被堵住了", expectSource: "孔", expectTerms: ["孔"] },
  { q: "钻孔边缘有毛刺", expectSource: "孔", expectTerms: ["孔", "毛刺"] },
  { q: "孔打偏了没对齐", expectSource: "孔", expectTerms: ["孔"] },

  // —— 喷锡 ——
  { q: "喷锡厚薄不均匀", expectSource: "喷锡", expectTerms: ["喷锡"] },
  { q: "锡面发黑氧化了", expectSource: "喷锡", expectTerms: ["喷锡"] },

  // —— 字符 / 丝印 ——
  { q: "丝印文字印糊了", expectSource: "字符", expectTerms: ["字符"] },
  { q: "字印歪了", expectSource: "字符", expectTerms: ["字符"] },

  // —— 碳油 ——
  { q: "碳油脱落了", expectSource: "碳油", expectTerms: ["碳油"] },

  // —— 金手指 / 化金 ——
  { q: "金手指有划伤", expectSource: "金手指", expectTerms: ["金手指"] },
  { q: "化金面发红", expectSource: "金手指", expectTerms: ["金手指", "化金"] },

  // —— 蓝胶 ——
  { q: "蓝胶残留没撕干净", expectSource: "蓝胶", expectTerms: ["蓝胶"] },

  // —— V-CUT / 成型 ——
  { q: "V割太深伤到线路了", expectSource: ["V-CUT", "成型"], expectTerms: ["V-CUT", "成型"] },

  // —— 机械加工 ——
  { q: "锣板后板边有毛刺", expectSource: ["机械加工", "成型"], expectTerms: ["机械加工", "毛刺"] },

  // —— 沉银 ——
  { q: "沉银表面发黑", expectSource: "沉银", expectTerms: ["沉银"] },

  // —— 板面及基材 ——
  { q: "板面有划伤", expectSource: "板面及基材", expectTerms: ["板面"] },

  // —— 模糊描述（仅观察，不打分）——
  { q: "这块板子外观看起来有问题", expectSource: null, expectTerms: [], ambiguous: true },
];

// 直接调 RAGFlow 检索，保留相似度（逻辑与 rag/retrieve.js 的 searchRagflow 一致）
async function retrieveWithScore(query) {
  const res = await fetch(`${RAGFLOW_BASE_URL}/api/v1/retrieval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(RAGFLOW_API_KEY ? { Authorization: `Bearer ${RAGFLOW_API_KEY}` } : {}),
    },
    body: JSON.stringify({ question: query, dataset_ids: RAGFLOW_DATASET_IDS }),
  });
  if (!res.ok) throw new Error(`RAGFlow HTTP ${res.status}`);
  const data = await res.json();
  const chunks = data?.data?.chunks ?? [];
  return chunks
    .filter((c) => (c.similarity ?? 0) >= SIMILARITY_THRESHOLD)
    .slice(0, TOP_K)
    .map((c) => ({
      text: c.content || c.content_with_weight || "",
      source: c.document_keyword || c.document_name || "",
      similarity: c.similarity ?? 0,
    }));
}

function matchSource(expect, hits) {
  if (expect == null) return null; // 模糊用例，不判定
  const hay = hits.map((h) => h.source).join(" ");
  const list = Array.isArray(expect) ? expect : [expect];
  return list.some((e) => hay.includes(e));
}

function matchTerms(expectTerms, reply) {
  if (!expectTerms || expectTerms.length === 0) return null;
  return expectTerms.some((t) => reply.includes(t));
}

function fmtExpect(expect) {
  if (expect == null) return "（模糊，不判定）";
  return Array.isArray(expect) ? expect.join(" / ") : expect;
}

function pickCases() {
  if (filter.length === 0) return cases;
  return cases.filter((c) =>
    filter.some((f) => c.q.includes(f) || JSON.stringify(c.expectSource).includes(f)),
  );
}

// ===== 检索层测试 =====
async function runRetrieval() {
  if (RAGFLOW_DATASET_IDS.length === 0) {
    console.error("未配置 RAGFLOW_DATASET_IDS，检索层测试需要 RAGFlow，请检查 .env");
    process.exit(1);
  }
  const list = pickCases();
  let pass = 0, fail = 0, amb = 0, miss = 0;

  console.log("术语混乱测试 —— 检索层");
  console.log(`相似度阈值 ${SIMILARITY_THRESHOLD}，取 top ${TOP_K}；共 ${list.length} 条用例\n`);

  for (const c of list) {
    let hits;
    try {
      hits = await retrieveWithScore(c.q);
    } catch (e) {
      console.log(`✗ 【${c.q}】检索失败：${e.message}\n`);
      fail++;
      continue;
    }

    const ok = matchSource(c.expectSource, hits);
    if (ok === null) amb++;
    else if (ok) pass++;
    else { fail++; if (hits.length === 0) miss++; }

    console.log(`【${c.q}】${c.ambiguous ? "（模糊用例，仅观察）" : ""}`);
    if (hits.length === 0) {
      console.log("  → 未命中知识库（相似度均低于阈值，会触发联网搜索兜底）");
    } else {
      for (const h of hits) {
        console.log(`  → 相似度 ${h.similarity.toFixed(3)} · ${h.source}`);
      }
    }
    if (ok !== null) {
      console.log(`  预期来源：${fmtExpect(c.expectSource)}  ${ok ? "✓ 命中" : "✗ 未命中"}`);
    }
    console.log("");
  }

  const total = pass + fail;
  const rate = total ? Math.round((pass / total) * 100) : 0;
  console.log("=".repeat(50));
  console.log(`结果：${pass} 通过 / ${fail} 未通过（其中 ${miss} 条彻底未命中）/ ${amb} 条模糊（不计分）`);
  console.log(`检索命中率：${rate}%`);
  if (miss > 0) {
    console.log("\n提示：彻底未命中说明该口语说法与标准资料的向量相似度低于阈值，");
    console.log("可在知识库里补充对应口语/别名资料，或调低 SIMILARITY_THRESHOLD 观察误召回。");
  }
}

// ===== 端到端测试 =====
async function runFull() {
  const { askPCB } = await import("../rag/ask.js");
  const list = pickCases();
  let pass = 0, fail = 0, amb = 0;

  console.log("术语混乱测试 —— 端到端（检索 + 大模型作答）");
  console.log(`共 ${list.length} 条用例，每条会调用一次大模型，请耐心等待\n`);

  for (const c of list) {
    let r;
    try {
      r = await askPCB(c.q);
    } catch (e) {
      console.log(`✗ 【${c.q}】处理失败：${e.message}\n`);
      fail++;
      continue;
    }

    const srcOk = matchSource(c.expectSource, r.sources);
    const termOk = matchTerms(c.expectTerms, r.reply);
    const ok = srcOk === null ? null : (srcOk && termOk !== false);

    if (ok === null) amb++;
    else if (ok) pass++;
    else fail++;

    const replyFlat = (r.reply || "").replace(/\s+/g, " ").trim();
    console.log(`【${c.q}】${c.ambiguous ? "（模糊用例，仅观察）" : ""}`);
    console.log(`  回答：${replyFlat.slice(0, 160)}${replyFlat.length > 160 ? "…" : ""}`);
    console.log(`  出处：${r.sources.length ? r.sources.map((s) => `${s.source}(${s.type})`).join("、") : "（无）"}`);
    console.log(`  预期来源：${fmtExpect(c.expectSource)}  ${srcOk === null ? "·" : srcOk ? "✓ 命中" : "✗ 未命中"}`);
    if (c.expectTerms && c.expectTerms.length) {
      console.log(`  预期术语：${c.expectTerms.join(" / ")}  ${termOk === null ? "·" : termOk ? "✓ 出现" : "✗ 未出现"}`);
    }
    console.log("");
  }

  const total = pass + fail;
  const rate = total ? Math.round((pass / total) * 100) : 0;
  console.log("=".repeat(50));
  console.log(`结果：${pass} 通过 / ${fail} 未通过 / ${amb} 条模糊（不计分）`);
  console.log(`端到端通过率：${rate}%`);
}

// 入口
if (mode === "full") {
  await runFull();
} else {
  await runRetrieval();
}
