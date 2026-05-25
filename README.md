# 手机网页临时 MVP

这是一个暂时的手机网页测试 MVP，先别当正式项目试。

当前模型调用走用户自己的 Supabase Edge Function：

- 前端保存 Supabase URL、anon key、function name
- OpenAI API key 不进入前端
- OpenAI API key 应放在 Supabase Edge Function secrets 里

内容库仍暂时写进浏览器本地存储；导出按钮会导出内容库和用户库，并把用户库里的 anon key 脱敏。

## Code split

- `app.js`: wires UI events, storage, chat logic, and service calls.
- `ui.js`: DOM rendering and prompt-version toolbar.
- `chatDomain.js`: conversation graph, node creation, prompt versions, context building.
- `browserStorageAdapter.js`: browser localStorage adapter.
- `edgeFunctionClient.js`: calls the fixed Supabase Edge Function `run-script`.
- `exportAdapter.js`: export JSON with user anon key redacted.
- `seeds.js`: empty content DB and empty user DB templates.
- `constants.js`: storage keys and fixed provider constants.
