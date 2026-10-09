const sendBtn = document.getElementById('send-btn');
const userInput = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');

// 后端服务器的地址
const API_BASE_URL = 'http://10.164.92.172:9100';

// 发送消息的核心逻辑
async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return; // 如果输入为空，不发送

    //  在页面上显示用户的消息
    addMessage(text, 'user-message');
    userInput.value = ''; // 清空输入框
    userInput.focus(); // 让光标自动回到输入框

    //  显示“正在思考中...”
    const loadingMsg = addMessage('正在思考中...', 'ai-message');

    try {
        //  给后端发请求 (fetch)
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: text })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        //  拿到后端的回复数据
        const data = await response.json();
        
        //  删掉“正在思考中...”的占位气泡
        if (loadingMsg && loadingMsg.parentNode) {
            chatBox.removeChild(loadingMsg);
        }

        //  显示 AI 真正的回复
        addMessage(data.reply || "抱歉，AI没有返回内容。", 'ai-message');

    } catch (error) {
        console.error('请求失败:', error);
        
        // 出错时也要删掉“正在思考中...”
        if (loadingMsg && loadingMsg.parentNode) {
            chatBox.removeChild(loadingMsg);
        }
        
        // 显示错误提示
        addMessage('抱歉，连接服务器失败了，请检查后端是否启动。', 'ai-message');
    }
}

// 往聊天框加消息
function addMessage(text, className) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + className;
    msgDiv.textContent = text;
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; // 自动滚到最底部
    
    return msgDiv; // 返回这个节点，方便上面代码出错时把它删掉
}

// 4. 绑定点击和回车事件
// 点击“发送”按钮
sendBtn.addEventListener('click', sendMessage);

// 按“回车键”也能发送
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});