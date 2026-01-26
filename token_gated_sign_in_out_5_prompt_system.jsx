import { useState } from "react";

export default function TokenGateDemo() {
  const MAX_TOKENS = 5;
  const accountLabel = "MK";

  const [signedIn, setSignedIn] = useState(false);
  const [tokens, setTokens] = useState(MAX_TOKENS);
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState([]);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const newEvent = (event) => ({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    ...event,
  });

  const signIn = () => {
    setSignedIn(true);
    setTokens(MAX_TOKENS);
    setPrompt("");
    setResult("");
    setError("");
    setLoading(false);
    setEvents([newEvent({ type: "sign_in", account: accountLabel })]);
  };

  const signOut = () => {
    setSignedIn(false);
    setTokens(MAX_TOKENS);
    setPrompt("");
    setResult("");
    setError("");
    setLoading(false);
    setEvents((prev) => [...prev, newEvent({ type: "sign_out" })]);
  };

  const submitPrompt = async () => {
    if (!signedIn || tokens === 0 || !prompt.trim() || loading) return;
    const promptToSend = prompt.trim();

    setLoading(true);
    setError("");
    setResult("");

    try {
      const response = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptToSend }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Request failed");
      }

      const text = String(data?.text ?? "");
      const hash = crypto.randomUUID(); // placeholder for SHA-256

      setResult(text);
      setEvents((prev) => [...prev, newEvent({ type: "prompt_burn", hash })]);
      setTokens((t) => t - 1);
      setPrompt("");
    } catch (e) {
      setError(e?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-neutral-900 rounded-2xl shadow-xl p-6 space-y-6">
        <header className="flex justify-between items-center">
          <div className="text-sm">Account: {signedIn ? accountLabel : "—"}</div>
          <div className="text-sm">
            Tokens: {signedIn ? `${tokens} / ${MAX_TOKENS}` : "—"}
          </div>
          {signedIn ? (
            <button onClick={signOut} className="text-red-400 text-sm">
              Log Out
            </button>
          ) : null}
        </header>

        {!signedIn ? (
          <button
            onClick={signIn}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition"
          >
            Log In
          </button>
        ) : (
          <div className="space-y-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                tokens === 1 ? "Final prompt. Choose your words." : "Enter prompt"
              }
              className="w-full h-28 rounded-xl bg-neutral-800 p-3 text-sm"
              disabled={tokens === 0 || loading}
            />
            <button
              onClick={submitPrompt}
              disabled={tokens === 0 || loading}
              className="w-full py-3 rounded-xl bg-emerald-600 disabled:bg-neutral-700"
            >
              {loading ? "Submitting…" : "Submit Prompt"}
            </button>
            {tokens === 0 && (
              <div className="text-xs text-neutral-400 text-center">
                No prompts remaining
              </div>
            )}

            {error && (
              <div className="text-xs text-red-300 bg-red-950/40 border border-red-900 rounded-xl p-3">
                {error}
              </div>
            )}

            {result && (
              <div className="text-xs text-neutral-200 bg-neutral-800/60 border border-neutral-700 rounded-xl p-3 whitespace-pre-wrap">
                {result}
              </div>
            )}
          </div>
        )}

        {events.length > 0 && (
          <div className="pt-4 border-t border-neutral-800 space-y-2">
            <div className="text-xs text-neutral-400">Activity Log</div>
            {events.map((e) => (
              <div key={e.id} className="text-xs font-mono text-neutral-500">
                {e.type === "sign_in"
                  ? `${e.time} · LOG_IN · ${e.account}`
                  : e.type === "sign_out"
                    ? `${e.time} · LOG_OUT`
                    : `${e.time} · BURN · ${e.hash}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
