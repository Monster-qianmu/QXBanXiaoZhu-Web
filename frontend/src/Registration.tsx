import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./api";

export type RegistrationRequest = {
  id: number;
  name: string;
  phone: string;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  auto_approve_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
  review_note: string;
  user_id: number | null;
};

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

export function RegistrationDialog({ onClose }: { onClose: (phone?: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: "", phone: "", password: "", confirm_password: "" });
  const [submitted, setSubmitted] = useState<RegistrationRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dialogRef.current?.open) dialogRef.current?.showModal(); }, []);
  const close = () => onClose(submitted?.phone);
  return <dialog ref={dialogRef} className="registration-dialog auth-card" aria-labelledby="registration-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <div className="registration-dialog-heading"><h2 id="registration-title">添加账号</h2><button type="button" className="icon-button" aria-label="关闭账号申请" disabled={busy} onClick={close}>×</button></div>
    {submitted ? <div className="registration-success" role="status">
      <h3>申请已提交</h3><p>请等待管理员审批。如管理员在提交后 24 小时内未处理，系统将自动同意。</p>
      <p>自动同意时间：<strong>{formatTime(submitted.auto_approve_at)}</strong></p>
      <p>通过后，使用手机号 <strong>{submitted.phone}</strong> 和申请时设置的密码登录。</p>
      <button type="button" className="primary-action" onClick={close}>返回登录</button>
    </div> : <>
      <p>填写信息并提交申请，通过后使用手机号登录。管理员 24 小时未审批，系统将自动同意。</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError("");
        if (!form.name.trim()) { setError("请填写姓名"); return; }
        if (form.password !== form.confirm_password) { setError("两次密码不一致"); return; }
        setBusy(true);
        try {
          const result = await request<RegistrationRequest>("/auth/registration-requests", { method: "POST", body: JSON.stringify(form) });
          setForm({ name: "", phone: "", password: "", confirm_password: "" });
          setSubmitted(result);
        } catch (failure) { setError((failure as Error).message); }
        finally { setBusy(false); }
      }}>
        <label>姓名<input required autoFocus autoComplete="name" maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label>
        <label>手机号<input required type="tel" inputMode="tel" autoComplete="tel" maxLength={32} placeholder="11 位手机号" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.currentTarget.value })} /></label>
        <label>密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.password} onChange={(event) => setForm({ ...form, password: event.currentTarget.value })} /></label>
        <label>确认密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.confirm_password} onChange={(event) => setForm({ ...form, confirm_password: event.currentTarget.value })} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="primary-action" disabled={busy}>{busy ? "正在提交…" : "提交申请"}</button>
      </form>
    </>}
  </dialog>;
}

const statusLabels = { pending: "待审批", approved: "已同意", rejected: "已拒绝" };

export function RegistrationRequestsPanel() {
  const queryClient = useQueryClient();
  const applicationsQuery = useQuery({
    queryKey: ["registration-requests"],
    queryFn: () => request<RegistrationRequest[]>("/admin/registration-requests"),
    refetchInterval: 15000
  });
  const [filter, setFilter] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [rejected, setRejected] = useState<RegistrationRequest | null>(null);
  const [note, setNote] = useState("");
  const rejectionDialogRef = useRef<HTMLDialogElement>(null);
  const applications = applicationsQuery.data ?? [];
  const pendingCount = applications.filter((item) => item.status === "pending").length;
  const visible = applications.filter((item) => filter === "all" || item.status === filter);
  useEffect(() => {
    if (applicationsQuery.dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  }, [applicationsQuery.dataUpdatedAt, queryClient]);
  useEffect(() => { if (rejected && !rejectionDialogRef.current?.open) rejectionDialogRef.current?.showModal(); }, [rejected]);

  async function review(item: RegistrationRequest, decision: "approve" | "reject", reviewNote = "") {
    setBusy(true); setStatus("");
    try {
      await request(`/admin/registration-requests/${item.id}/review`, { method: "POST", body: JSON.stringify({ decision, note: reviewNote }) });
      setStatus(`${item.name} 的申请已${decision === "approve" ? "同意，可使用手机号登录" : "拒绝"}`);
      setRejected(null); setNote("");
    } catch (failure) { setStatus((failure as Error).message); }
    finally {
      await queryClient.invalidateQueries({ queryKey: ["registration-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setBusy(false);
    }
  }
  return <section className="registration-review-panel" aria-labelledby="registration-review-title">
    <div className="panel-heading"><div><h2 id="registration-review-title">账号申请审批 <span className="pending-badge">{pendingCount} 待审批</span></h2><p>提交满 24 小时仍未处理的申请将自动同意；已拒绝的申请不会自动通过。</p></div>
      <div className="actions"><select aria-label="申请状态筛选" value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
        <option value="pending">待审批</option><option value="approved">已同意</option><option value="rejected">已拒绝</option><option value="all">全部申请</option>
      </select><button className="text-button" disabled={applicationsQuery.isFetching || busy} onClick={() => void applicationsQuery.refetch()}>刷新申请</button></div>
    </div>
    {(status || applicationsQuery.error) && <p className="status-line" role="status">{status || applicationsQuery.error?.message}</p>}
    <div className="table-wrap"><table><thead><tr><th>姓名</th><th>手机号</th><th>申请时间</th><th>自动同意时间</th><th>状态</th><th>审批记录</th><th>操作</th></tr></thead><tbody>
      {visible.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.phone}</td><td>{formatTime(item.submitted_at)}</td><td>{formatTime(item.auto_approve_at)}</td><td><span className={`registration-status ${item.status}`}>{statusLabels[item.status]}</span></td><td>
        {item.reviewed_at && <small>{formatTime(item.reviewed_at)} · {item.reviewed_by ? "管理员" : "系统"}<br /></small>}{item.review_note || "等待处理"}
      </td><td>{item.status === "pending" && <div className="actions">
        <button className="text-button approve-action" disabled={busy} onClick={() => void review(item, "approve")}>同意</button>
        <button className="text-button danger" disabled={busy} onClick={() => { setNote(""); setStatus(""); setRejected(item); }}>拒绝</button>
      </div>}</td></tr>)}
      {!visible.length && <tr><td colSpan={7} className="empty-cell">{applicationsQuery.isLoading ? "正在读取申请…" : "暂无此类账号申请"}</td></tr>}
    </tbody></table></div>
    {rejected && <dialog ref={rejectionDialogRef} className="registration-dialog auth-card" aria-labelledby="reject-registration-title" onCancel={(event) => { event.preventDefault(); if (!busy) setRejected(null); }}>
      <h2 id="reject-registration-title">拒绝 {rejected.name} 的申请</h2><p>拒绝后，该申请不会在满 24 小时时自动通过。</p>
      <form onSubmit={(event) => { event.preventDefault(); void review(rejected, "reject", note); }}>
        <label>拒绝原因（选填）<textarea maxLength={300} value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="可填写原因，申请人登录时会看到该说明" /></label>
        {status && <div className="auth-error" role="alert">{status}</div>}
        <button className="primary-action" disabled={busy}>确认拒绝</button><button type="button" className="text-button" disabled={busy} onClick={() => setRejected(null)}>取消</button>
      </form>
    </dialog>}
  </section>;
}
