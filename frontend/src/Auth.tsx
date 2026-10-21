import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./api";
import type { User } from "./types";
import { RegistrationDialog, RegistrationRequestsPanel } from "./Registration";

type AuthActions = { user: User; logout: () => void; changePassword: () => void };

export function AuthGate({ children }: { children: (actions: AuthActions) => ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState({ username: "", display_name: "", password: "", confirm: "" });
  useEffect(() => {
    let active = true;
    request<{ needs_setup: boolean }>("/auth/status").then(async (status) => {
      if (!active) return;
      setSetup(status.needs_setup);
      if (!status.needs_setup) {
        const loggedIn = await request<User>("/auth/me").catch(() => null);
        if (active) setUser(loggedIn);
      }
    }).catch((failure: Error) => { if (active) setError(failure.message); }).finally(() => { if (active) setReady(true); });
    const expire = () => { queryClient.clear(); setUser(null); setEditingPassword(false); setError("登录已过期，请重新登录"); };
    window.addEventListener("qxban-auth-expired", expire);
    return () => { active = false; window.removeEventListener("qxban-auth-expired", expire); };
  }, [queryClient]);
  async function logout() {
    try { await request("/auth/logout", { method: "POST" }); queryClient.clear(); setUser(null); setError(""); }
    catch (failure) { setError((failure as Error).message); }
  }
  if (!ready) return <main className="auth-shell"><section className="auth-card">正在连接 QX班小助…</section></main>;
  if (user) {
    if (user.must_change_password || editingPassword) return <PasswordForm forced={user.must_change_password} onDone={(next) => { queryClient.clear(); setUser(next); setEditingPassword(false); }} onCancel={() => setEditingPassword(false)} />;
    return <>{error && <p role="alert" className="auth-error">{error}</p>}{children({ user, logout, changePassword: () => setEditingPassword(true) })}</>;
  }
  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand">QX</div><h1>QX班小助</h1><p>{setup ? "首次使用，请设置管理员账号" : "登录后管理班级与学生信息"}</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setError("");
      if (setup && credentials.password !== credentials.confirm) { setError("两次密码不一致"); return; }
      setBusy(true);
      try {
        const next = await request<User>(setup ? "/auth/setup" : "/auth/login", { method: "POST", body: JSON.stringify(credentials) });
        queryClient.clear(); setUser(next); setSetup(false); setCredentials({ username: "", display_name: "", password: "", confirm: "" });
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <label>{setup ? "账号" : "账号 / 手机号"}<input required autoComplete="username" minLength={3} maxLength={64} value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.currentTarget.value })} /></label>
      {setup && <label>显示姓名<input maxLength={100} autoComplete="name" value={credentials.display_name} onChange={(event) => setCredentials({ ...credentials, display_name: event.currentTarget.value })} /></label>}
      <label>密码<input required type="password" minLength={setup ? 8 : 1} maxLength={128} autoComplete={setup ? "new-password" : "current-password"} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.currentTarget.value })} /></label>
      {setup && <label>确认密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={credentials.confirm} onChange={(event) => setCredentials({ ...credentials, confirm: event.currentTarget.value })} /></label>}
      {error && <div role="alert" className="auth-error">{error}</div>}
      <button className="primary-action" disabled={busy}>{busy ? "处理中…" : setup ? "创建管理员并进入系统" : "登录"}</button>
    </form><small>{setup ? "账号支持字母、数字及 _ . @ -，密码至少 8 位。" : "可使用账号或审核通过的手机号登录；忘记密码请联系管理员。"}</small>
    {!setup && <div className="auth-registration-entry"><span>还没有账号？</span><button type="button" className="text-button" onClick={() => setShowRegistration(true)}>添加账号</button></div>}
    {showRegistration && <RegistrationDialog onClose={(phone) => {
      if (phone) setCredentials((current) => ({ ...current, username: phone, password: "" }));
      setShowRegistration(false); setError("");
    }} />}
  </section></main>;
}

function PasswordForm({ forced, onDone, onCancel }: { forced: boolean; onDone: (user: User) => void; onCancel: () => void }) {
  const [values, setValues] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <main className="auth-shell"><section className="auth-card"><h1>修改密码</h1><p>{forced ? "请先修改管理员设置的初始密码" : "修改后，其他设备上的登录会失效"}</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setError("");
      if (values.new_password !== values.confirm) { setError("两次新密码不一致"); return; }
      setBusy(true);
      try { onDone(await request<User>("/auth/change-password", { method: "POST", body: JSON.stringify(values) })); }
      catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <label>当前密码<input required type="password" autoComplete="current-password" maxLength={128} value={values.current_password} onChange={(event) => setValues({ ...values, current_password: event.currentTarget.value })} /></label>
      <label>新密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={values.new_password} onChange={(event) => setValues({ ...values, new_password: event.currentTarget.value })} /></label>
      <label>确认新密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={values.confirm} onChange={(event) => setValues({ ...values, confirm: event.currentTarget.value })} /></label>
      {error && <div role="alert" className="auth-error">{error}</div>}
      <button className="primary-action" disabled={busy}>保存新密码</button>{!forced && <button type="button" className="text-button" onClick={onCancel}>取消</button>}
    </form></section></main>;
}

export function AccountsPage() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: () => request<User[]>("/admin/users") });
  const [form, setForm] = useState({ username: "", display_name: "", password: "" });
  const [resetUser, setResetUser] = useState<User | null>(null); const [password, setPassword] = useState("");
  const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success: string, after?: () => void) {
    setBusy(true); setStatus("");
    try { await action(); setStatus(success); after?.(); await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); }
    catch (failure) { setStatus((failure as Error).message); } finally { setBusy(false); }
  }
  return <section className="tool-panel accounts-panel"><div className="panel-heading"><div><h2>账号管理</h2><p>添加或导入普通用户，管理账号状态与密码</p></div>
    <div className="actions"><a className="text-button" href="/api/v1/admin/users/template">下载账号样表</a><label className="text-button">导入账号表<input type="file" accept=".xlsx" disabled={busy} onChange={(event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      const data = new FormData(); data.append("file", file);
      void run(() => request("/admin/users/import", { method: "POST", body: data }), "账号表已成功导入");
    }} /></label></div></div>
    <RegistrationRequestsPanel />
    <form className="account-add-form" onSubmit={(event) => { event.preventDefault(); void run(() => request("/admin/users", { method: "POST", body: JSON.stringify(form) }), "普通用户已创建，首次登录须修改密码", () => setForm({ username: "", display_name: "", password: "" })); }}>
      <label>账号<input required aria-label="新用户账号" minLength={3} maxLength={64} value={form.username} onChange={(event) => setForm({ ...form, username: event.currentTarget.value })} /></label>
      <label>姓名<input aria-label="新用户姓名" maxLength={100} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.currentTarget.value })} /></label>
      <label>初始密码<input required aria-label="新用户初始密码" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.password} onChange={(event) => setForm({ ...form, password: event.currentTarget.value })} /></label>
      <button className="primary-action" disabled={busy}>添加普通用户</button>
    </form>
    <p className="account-hint">导入表列：账号、姓名、初始密码。每次最多 500 人；有错误时整批不导入，修正后重新上传。普通用户仅能访问自己的班级。</p>
    {(status || usersQuery.error) && <p role="status" className="status-line">{status || usersQuery.error?.message}</p>}
    <div className="table-wrap"><table><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>密码状态</th><th>操作</th></tr></thead><tbody>
      {(usersQuery.data ?? []).map((item) => <tr key={item.id}><td>{item.username}</td><td>{item.display_name}</td><td>{item.role === "admin" ? "管理员" : "普通用户"}</td><td>{item.is_active ? "正常" : "已停用"}</td><td>{item.must_change_password ? "待修改初始密码" : "已设置"}</td><td>{item.role === "user" && <div className="actions">
        <button className="text-button" disabled={busy} onClick={() => { setResetUser(item); setPassword(""); }}>重置密码</button>
        <button className="text-button" disabled={busy} onClick={() => { if (window.confirm(`${item.is_active ? "停用" : "启用"}账号 ${item.username}？`)) void run(() => request(`/admin/users/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !item.is_active }) }), "账号状态已更新"); }}>{item.is_active ? "停用" : "启用"}</button>
      </div>}</td></tr>)}
    </tbody></table></div>
    {resetUser && <div className="modal-backdrop"><section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">重置 {resetUser.username} 的密码</h2><p>保存后该用户已有登录失效，下次登录须修改密码。</p>
      <form onSubmit={(event) => { event.preventDefault(); void run(() => request(`/admin/users/${resetUser.id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }), "密码已重置", () => { setResetUser(null); setPassword(""); }); }}>
        <label>新初始密码<input required autoFocus aria-label="重置后的初始密码" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        <button className="primary-action" disabled={busy}>确认重置</button><button type="button" className="text-button" disabled={busy} onClick={() => { setResetUser(null); setPassword(""); }}>取消</button>
      </form></section></div>}
  </section>;
}
