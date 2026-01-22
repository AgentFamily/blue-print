# iPhone Deployment (PocketPal-style)

This project is a web UI (`Homepage.html`) that talks to an Ollama-style `/api/*` backend.

There are two practical ways to use it on iPhone:

## A) Fastest: iPhone as client, Mac runs the model (no cloud)

This keeps everything local/offline (your Wi‑Fi only), but the **LLM runs on your Mac**.

1. Make sure your iPhone + Mac are on the same Wi‑Fi.
2. Start Ollama on your Mac (the server must be reachable at `http://127.0.0.1:11434`).
3. Start the homepage server in LAN mode:
   - If you use LocalLLM’s scripts:
     - `"/Users/mahdikarimianzadeh/Library/Application Support/LocalLLM/bin/start-homepage-server.sh"`
   - Or directly:
     - `python3 "Contents/Resources/dev_server.py" --lan --port 8000 --upstream http://127.0.0.1:11434`
4. On iPhone Safari open:
   - `http://<your-mac-ip>:8000/Homepage.html`

Notes:
- The server is now safe to expose on LAN because **Tools are loopback-only** (iPhone won’t get the tool token).
- For “PocketPal-like” speed, pick small models (1B–2B, 4‑bit quantized) and keep `num_ctx` and `num_predict` modest.

## B) True on-device: build an iOS app that runs GGUF locally (offline)

This is the PocketPal approach: **llama.cpp + GGUF quantized models** on-device (no server, no cloud).

High-level steps:
1. Install Xcode on your Mac.
2. Create an iOS App (SwiftUI).
3. Add the web UI as resources:
   - `Homepage.html`
   - `emoji-palette.json`
4. Load the UI in a `WKWebView`.
5. Implement an Ollama-compatible HTTP shim inside the app:
   - `GET /api/tags` → list local `.gguf` models
   - `POST /api/chat` → run inference on-device and return `{ "message": { "content": "..." } }`
6. Integrate `llama.cpp` (Metal enabled) and ship/import a small GGUF model:
   - Recommended: `Q4_K_M`/`Q4_0` quantizations for mobile.
   - Keep context around `1024–2048` for speed and memory stability.

Minimal Swift shape (pseudo-code):
```swift
struct ChatMessage: Codable { let role: String; let content: String }
struct ChatRequest: Codable { let model: String; let messages: [ChatMessage]; let options: Options? }
struct Options: Codable { let num_ctx: Int?; let num_predict: Int?; let temperature: Double? }

// /api/chat handler
let prompt = Llama.format(messages, model: req.model) // use chat template from GGUF metadata
let text = try await Llama.generate(prompt: prompt,
                                   maxTokens: req.options?.num_predict ?? 128,
                                   temperature: req.options?.temperature ?? 0.7)
return ["message": ["content": text]]
```

For the llama.cpp integration, follow PocketPal’s build settings: use Metal, prefer smaller context windows, and use quantized GGUF models.

