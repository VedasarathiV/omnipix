# DeepSeek

DeepSeek uses `https://api.deepseek.com` with bearer authentication for
OpenAI-compatible chat completions (including streaming). Note the bare host:
unlike most OpenAI-compatible APIs there is **no `/v1` path segment** — chat is
`POST /chat/completions` and key validation is `GET /models`. Create a key at
[DeepSeek Platform](https://platform.deepseek.com/api_keys), add it on the Keys
page, or import `DEEPSEEK_API_KEY`. Auth JSON recognizes `deepseek`.

This is a **paid API with no free tier**, included as the cheapest reasoning
tier available anywhere: at peak rates `deepseek-flash` bills ~$0.30/$1.20 per
1M input/output tokens and `deepseek-v4-pro` ~$1.32/$3.96 (off-peak is half;
see [pricing](https://api-docs.deepseek.com/quick_start/pricing)). Both models
serve a 1M-token context window with tool calling; only Flash supports vision.

Thinking mode is ON by default server-side. `reasoning_effort` (`low`/`high`/
`max`) is forwarded when the client sends it, and `reasoning_content` in
responses is folded into message content by the shared adapter. The `thinking`
toggle itself is not sent yet — DeepSeek's default matches, so this only
matters for explicitly disabling thought.

Key validation is a plain authenticated `GET /models` (no inference spend).
Live probing with a real key is still pending — see the repo TODO.
