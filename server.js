// server.js
import express from 'express';
import cors from 'cors';
import { createAgentSession } from '@earendil-works/pi-coding-agent';

const app = express();
const PORT = 9100;

// 允许前端跨域访问，并解析 JSON 请求体
app.use(cors());
app.use(express.json());

//  聊天接口
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: '消息不能为空' });
  }

  try {
    // 创建一个 Agent 会话
    const { session } = await createAgentSession();

    // 用来收集流式返回的文本
    let replyText = '';

    session.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        replyText += event.assistantMessageEvent.delta;
      }
    });

    // 发送用户消息，等待处理完成
    await session.prompt(message);

    // 返回完整回复给前端
    res.json({ reply: replyText });
  } catch (error) {
    console.error('Agent 处理出错:', error);
    res.status(500).json({ error: 'Agent 处理失败，请查看后端日志node server.js' });
  }
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
  console.log(` 后端服务已启动: http://0.0.0.0:${PORT}`);
});