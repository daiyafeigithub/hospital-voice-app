# 医院智能助手

语音提问 → 大模型理解 → 知识库检索 → 视频推荐播放

## 技术栈

- **前端**: Next.js 16 + Tailwind CSS
- **语音识别**: Web Speech API（Chrome 浏览器原生支持中文）
- **大模型**: 通义千问（DashScope API，qwen-plus）
- **知识库检索**: RAG 关键词匹配（可升级为向量检索）
- **视频管理**: JSON 元数据 + 标签匹配

## 快速开始

```bash
npm install

# 配置 API Key（可选，不配置则使用本地关键词匹配）
# 编辑 .env.local，填入通义千问 API Key: DASHSCOPE_API_KEY=sk-xxxxx

npm run dev
# 或: npm run build && npm start
```

## 功能说明

1. **语音输入** - 点击麦克风按钮，用中文说出你的问题
2. **文字输入** - 直接输入文字提问
3. **智能回答** - 基于医院知识库文档生成通俗易懂的回答
4. **视频推荐** - 根据问题自动匹配相关宣教视频
5. **常见问题** - 首页展示快捷问题按钮，方便老年患者

## 配置通义千问

1. 访问 https://dashscope.console.aliyun.com/ 获取 API Key
2. 编辑 `.env.local` 文件
3. 填入 `DASHSCOPE_API_KEY=sk-你的key`

## 扩展知识库

- 编辑 `src/data/knowledge-base.json` 添加医疗文档
- 编辑 `src/data/videos.json` 添加视频资源
- 每个知识条目包含 id、title、content、tags
- 每个视频条目包含 id、title、description、url、duration、category、tags
