"use client";

import { useEffect, useState, useRef } from "react";
import { fmtSize } from "@/lib/utils";

type Item = {
  id: string; name: string; isFolder: boolean; size: number | null;
  mime: string | null; updatedAt: string; parentId: string | null;
};

/* login gate */
function LoginGate({ onReady }: { onReady: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "start", phone }) });
    const j = await r.json();
    setBusy(false);
    if (j.error) { setMsg(j.error); return; }
    setLoginId(j.loginId);
    setMsg("Code sent — check your Telegram");
  }
  async function verify() {
    setBusy(true); setMsg("Verifying…");
    const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "code", phone, loginId, code }) });
    const j = await r.json();
    setBusy(false);
    if (j.status === "done") { onReady(); return; }
    setMsg(j.error || j.status || "Sign-in failed");
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo-lg">T</div>
        <h1>Telegram Drive</h1>
        <p className="sub">Your files live in your own Telegram account.</p>
        <div className="box">
          <input className="text" placeholder="+91 98765 43210"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          {!loginId ? (
            <button className="btn primary" onClick={send} disabled={busy || !phone}>
              {busy ? "Sending…" : "Continue"}
            </button>
          ) : (
            <>
              <input className="text" placeholder="Login code"
                value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn primary" onClick={verify} disabled={busy || !code}>
                {busy ? "Verifying…" : "Sign in"}
              </button>
            </>
          )}
          {msg && <div className="err">{msg}</div>}
        </div>
      </div>
    </div>
  );
}

function FileIcon({ mime, isFolder }: { mime: string | null | undefined; isFolder: boolean }) {
  if (isFolder) return <span className="ficon">📁</span>;
  const m = mime || "";
  const ico = m.startsWith("image/") ? "🖼️" : m.startsWith("video/") ? "🎬" :
    m.startsWith("audio/") ? "🎵" : m.includes("pdf") ? "📕" :
    m.includes("zip") || m.includes("compressed") ? "🗜️" : m.startsWith("text/") ? "📄" : "📄";
  return <span className="ficon">{ico}</span>;
}

export default function FileManager() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState<"list" | "grid">("list");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"name" | "date" | "size">("name");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function closeMenu() { setMenuFor(null); }
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, []);

  const load = async (parent: string | null) => {
    const q = parent ? `?parentId=${parent}` : "";
    const r = await fetch(`/api/files/list${q}`);
    if (r.status === 401) return;
    const j = await r.json();
    setItems((j.items || []).map((x: any) => ({ ...x, updatedAt: x.updatedAt || new Date().toISOString() })));
    setSel(new Set());
  };
  useEffect(() => { if (ready) load(folder); }, [ready, folder]); // eslint-disable-line

  function openItem(it: Item) {
    if (it.isFolder) { setTrail((t) => [...t, { id: it.id, name: it.name }]); setFolder(it.id); }
    else window.open(`/api/files/${it.id}`, "_blank");
  }
  function navi(i: number, id: string | null) {
    setTrail(trail.slice(0, i)); setFolder(id);
  }
  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function sortFn(a: Item, b: Item) {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    if (sortBy === "size") return (a.size || 0) - (b.size || 0);
    if (sortBy === "date") return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    return a.name.localeCompare(b.name);
  }
  const visible = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())).sort(sortFn);
  const allSel = visible.length > 0 && visible.every((v) => sel.has(v.id));

  async function uploadFile(file: File) {
    setProgress({ name: file.name, pct: 0 });
    const meta = await (await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, parentId: folder, size: file.size }) })).json();
    if (meta.error) { alert(meta.error); setProgress(null); return; }
    for (let i = 0; i < meta.parts; i++) {
      const slice = file.slice(i * meta.partSize, (i + 1) * meta.partSize);
      await fetch(`/api/upload?uploadId=${meta.uploadId}&part=${i}`, { method: "PUT", body: slice });
      setProgress({ name: file.name, pct: Math.round(((i + 1) / meta.parts) * 100) });
    }
    await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", uploadId: meta.uploadId, mime: file.type || "application/octet-stream" }) });
    setProgress(null);
    load(folder);
  }

  async function del(id: string) { await fetch(`/api/files/${id}`, { method: "DELETE" }); load(folder); }
  async function bulkDelete() {
    for (const id of Array.from(sel)) await del(id);
    setSel(new Set());
  }
  async function createFolder() {
    setFolderDialog(false);
    if (!newFolderName) return;
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", name: newFolderName, parentId: folder }) });
    setNewFolderName(""); load(folder);
  }

  if (!ready) return <LoginGate onReady={() => setReady(true)} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><div className="logo">T</div><span>Telegram Drive</span></div>
        <nav>
          <button className="nav-item active" onClick={() => { setFolder(null); setTrail([]); }}>My Drive</button>
          <button className="nav-item" onClick={async () => {
            await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ step: "logout" }) });
            location.reload();
          }}>Sign out</button>
        </nav>
      </aside>

      <main className="main">
        <div className="toolbar">
          <input className="text" style={{ width: 260 }} placeholder="Search…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="spacer" />
          <div className="seg">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button>
          </div>
          <button className="btn secondary sm" onClick={() => setFolderDialog(true)}>New folder</button>
          <button className="btn primary sm" onClick={() => fileRef.current?.click()}>Upload</button>
        </div>

        <div className="crumbs">
          <button className={trail.length === 0 ? "current" : ""}
            onClick={() => { setTrail([]); setFolder(null); }}>My Drive</button>
          {trail.map((t, i) => (
            <span key={t.id} style={{ display: "flex", gap: 6 }}>
              <span className="sep">/</span>
              <button className={i === trail.length - 1 ? "current" : ""}
                onClick={() => { setTrail(trail.slice(0, i + 1)); setFolder(t.id); }}>{t.name}</button>
            </span>
          ))}
        </div>

        <div className="panel">
          {view === "list" ? (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
                    <button className={allSel ? "cbx checked" : "cbx"}
                      onClick={() => setSel(allSel ? new Set() : new Set(visible.map((v) => v.id)))}
                      style={{ all: "unset", cursor: "pointer", width: 15, height: 15, borderRadius: 4,
                        border: "1px solid var(--muted)", display: "inline-flex", alignItems: "center",
                        justifyContent: "center", background: allSel ? "var(--accent)" : "transparent",
                        color: allSel ? "#fff" : "transparent", fontSize: 10 }}>✓</button>
                  </th>
                  <th onClick={() => setSortBy("name")}>Name {sortBy === "name" ? " ↑" : ""}</th>
                  <th style={{ width: 120 }} onClick={() => setSortBy("date")}>Modified {sortBy === "date" ? " ↑" : ""}</th>
                  <th style={{ width: 90 }} onClick={() => setSortBy("size")}>Size {sortBy === "size" ? " ↑" : ""}</th>
                  <th style={{ width: 44, cursor: "default" }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => (
                  <tr key={it.id} className={sel.has(it.id) ? "selected" : ""}>
                    <td>
                      <button className={sel.has(it.id) ? "cbx checked" : "cbx"} onClick={() => toggle(it.id)}>✓</button>
                    </td>
                    <td>
                      <div className="name" onClick={() => toggle(it.id)} onDoubleClick={() => openItem(it)}>
                        <FileIcon mime={it.mime} isFolder={it.isFolder} />
                        <span>{it.name}</span>
                      </div>
                    </td>
                    <td className="muted">{new Date(it.updatedAt).toLocaleDateString()}</td>
                    <td className="muted">{it.isFolder ? "—" : fmtSize(it.size)}</td>
                    <td style={{ position: "relative" }}>
                      <button
                        className="btn ghost sm"
                        onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === it.id ? null : it.id); }}>⋯</button>
                      {menuFor === it.id && (
                        <div className="rowmenu" onClick={(e) => e.stopPropagation()}>
                          <div className="menuitem" onClick={() => { setMenuFor(null); openItem(it); }}>
                            {it.isFolder ? "Open" : "Download"}</div>
                          <div className="menuitem" onClick={() => { setDetail(it); setMenuFor(null); }}>Details</div>
                          <div className="menuitem red" onClick={() => { del(it.id); setMenuFor(null); }}>Delete</div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid-wrap">
              {visible.map((it) => (
                <div key={it.id}
                  className={["grid-card", sel.has(it.id) ? "selected" : ""].filter(Boolean).join(" ")}
                  onClick={() => toggle(it.id)} onDoubleClick={() => openItem(it)}>
                  <FileIcon mime={it.mime} isFolder={it.isFolder} />
                  <div className="t">{it.name}</div>
                  <div className="s">{it.isFolder ? "Folder" : fmtSize(it.size)}</div>
                </div>
              ))}
            </div>
          )}
          {visible.length === 0 && (
            <div className="empty"><div className="big">📂</div>No files yet — upload something.</div>
          )}
        </div>

        {sel.size > 0 && (
          <div className="floatbar">
            <span className="label">{sel.size} selected</span>
            <button className="btn danger sm" onClick={bulkDelete}>Delete</button>
            <button className="btn ghost sm" onClick={() => setSel(new Set())}>Cancel</button>
          </div>
        )}

        {progress && (
          <div className="progcard">
            <div className="fname">{progress.name}</div>
            <div className="progbar"><div style={{ width: progress.pct + "%" }} /></div>
          </div>
        )}

        <input ref={fileRef} type="file" style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />

        {folderDialog && (
          <div className="overlay" onClick={() => setFolderDialog(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>New folder</h3>
              <input className="text" style={{ width: "100%" }} autoFocus placeholder="Folder name"
                value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createFolder()} />
              <div className="actions">
                <button className="btn ghost sm" onClick={() => setFolderDialog(false)}>Cancel</button>
                <button className="btn primary sm" onClick={createFolder}>Create</button>
              </div>
            </div>
          </div>
        )}

        {detail && (
          <div className="overlay" onClick={() => setDetail(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-head"><h3>Details</h3><button onClick={() => setDetail(null)}>✕</button></div>
              <dl className="details">
                <dt>Name</dt><dd>{detail.name}</dd>
                <dt>Type</dt><dd>{detail.isFolder ? "Folder" : detail.mime || "file"}</dd>
                <dt>Size</dt><dd>{detail.isFolder ? "—" : fmtSize(detail.size)}</dd>
                <dt>Modified</dt><dd>{new Date(detail.updatedAt).toLocaleString()}</dd>
              </dl>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
