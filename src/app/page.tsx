"use client";
import { useState, useCallback, useRef, useEffect } from "react";

type Item = {
  id: string; name: string; isFolder: boolean; size: number | null;
  mime: string | null; updatedAt: string;
};

export default function Home() {
  const [stage, setStage] = useState<"login" | "drive">("login");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [progress, setProgress] = useState<{ name: string; pct: number; done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- auth ----
  async function startLogin() {
    setMsg("sending code...");
    const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "start", phone }) });
    const j = await r.json();
    if (j.error) { setMsg(j.error); return; }
    setLoginId(j.loginId);
    setMsg("code sent to your Telegram");
  }
  async function submitCode() {
    setMsg("verifying...");
    const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "code", phone, loginId, code }) });
    const j = await r.json();
    if (j.error || j.status !== "done") { setMsg(j.error || j.status); return; }
    // server should set a uid cookie; treat as logged in
    setStage("drive");
    load(null);
  }

  // ---- drive ----
  const load = useCallback(async (parentId: string | null) => {
    const q = parentId ? `?parentId=${parentId}` : "";
    const r = await fetch(`/api/files/list${q}`);
    if (r.status === 401) { setStage("login"); return; }
    const j = await r.json();
    setItems(j.items || []);
  }, []);

  useEffect(() => { if (stage === "drive") load(folder); }, [stage, folder, load]);

  async function uploadFile(file: File) {
    const meta = await (await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, parentId: folder, size: file.size }) })).json();
    if (meta.error) { setMsg(meta.error); return; }
    const { uploadId, partSize, parts } = meta;
    for (let i = 0; i < parts; i++) {
      const slice = file.slice(i * partSize, (i + 1) * partSize);
      const r = await fetch(`/api/upload?uploadId=${uploadId}&part=${i}`, { method: "PUT", body: slice });
      const j = await r.json();
      if (j.error) { setMsg("upload failed at part " + i + ": " + j.error); return; }
      setProgress({ name: file.name, pct: Math.round(((i + 1) / parts) * 100), done: i + 1, total: parts });
    }
    await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", uploadId, mime: file.type || "application/octet-stream" }) });
    setProgress(null);
    load(folder);
  }

  async function mkcol() {
    const name = prompt("folder name");
    if (!name) return;
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", name, parentId: folder }) });
    load(folder);
  }

  if (stage === "login") {
    return (
      <main style={{ maxWidth: 380, margin: "12vh auto", padding: 20 }}>
        <h1>Telegram Drive</h1>
        <p style={{ color: "#9aa3b2" }}>Your files are stored in your own Telegram account (Saved Messages).</p>
        <input placeholder="+91..." value={phone} onChange={(e) => setPhone(e.target.value)}
          style={inp} />
        {loginId && <input placeholder="login code" value={code} onChange={(e) => setCode(e.target.value)} style={inp} />}
        <div style={{ display: "flex", gap: 8 }}>
          {!loginId && <button onClick={startLogin} style={btn}>Send code</button>}
          {loginId && <button onClick={submitCode} style={btn}>Verify & enter</button>}
        </div>
        {msg && <p style={{ color: "#f2c14e" }}>{msg}</p>}
        <p style={{ color: "#666f7d", fontSize: 12 }}>
          login codes arrive in your Telegram app; sessions are stored server-side encrypted.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Telegram Drive</h1>
        <div>
          <button onClick={mkcol} style={btn}>New folder</button>
          <button onClick={() => inputRef.current?.click()} style={btn}>Upload</button>
        </div>
      </div>
      <input ref={inputRef} type="file" style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
      {trail.length > 0 && (
        <p>
          <a href="#" onClick={(e) => { e.preventDefault(); setTrail([]); setFolder(null); }} style={{ color: "#6ea8fe" }}>root</a>
          {trail.map((t) => (
            <span key={t.id}>
              {" / "}
              <a href="#" onClick={(e) => { e.preventDefault();
                setTrail(trail.slice(0, trail.findIndex((x) => x.id === t.id) + 1));
                setFolder(t.id); }} style={{ color: "#6ea8fe" }}>{t.name}</a>
            </span>
          ))}
        </p>
      )}
      {progress && <p style={{ color: "#9aa3b2" }}>{progress.name}: {progress.pct}% ({progress.done}/{progress.total} parts)</p>}
      {msg && <p style={{ color: "#f2c14e" }}>{msg}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid #232833" }}>
              <td style={{ padding: 8 }}>
                {it.isFolder ? (
                  <a href="#" onClick={(e) => { e.preventDefault();
                    setTrail([...trail, { id: it.id, name: it.name }]); setFolder(it.id); }}
                    style={{ color: "#6ea8fe" }}>{it.name}/</a>
                ) : (
                  <a href={`/api/files/${it.id}`} style={{ color: "#e6e8ee" }}>{it.name}</a>
                )}
              </td>
              <td style={{ color: "#9aa3b2", width: 110 }}>{it.isFolder ? "—" : fmtSize(it.size)}</td>
              <td style={{ width: 40 }}>
                {!it.isFolder && (
                  <a href="#" onClick={async (e) => { e.preventDefault();
                    await fetch(`/api/files/${it.id}`, { method: "DELETE" }); load(folder); }}
                    style={{ color: "#e57373" }}>del</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p style={{ color: "#666f7d" }}>empty — upload something.</p>}
    </main>
  );
}

function fmtSize(n: number | null) {
  if (!n) return "";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 ** 3).toFixed(2) + " GB";
}

const inp: React.CSSProperties = { width: "100%", padding: 10, marginBottom: 10,
  background: "#181c24", border: "1px solid #2a3040", color: "#e6e8ee", borderRadius: 6 };
const btn: React.CSSProperties = { padding: "8px 14px", background: "#2f6fed", color: "#fff",
  border: 0, borderRadius: 6, cursor: "pointer" };
