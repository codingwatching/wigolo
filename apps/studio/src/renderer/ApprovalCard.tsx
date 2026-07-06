import type { PendingApproval, ApprovalVerdict } from './approval-store';

// The minimal placeholder approval card (P1). A risky agent action the host parked shows here with
// plain Allow/Deny — there is NO auto-resolve or timeout, so an action is never silently allowed
// (spec §10-P1). Amber = pending approval (spec §4 color language). The rich card UX is P4.

const RISK_COPY: Record<PendingApproval['risk'], string> = {
  money: 'a money action',
  credential: 'a credential action',
  destructive: 'a destructive action',
};

export function ApprovalCards({
  pending,
  onDecide,
}: {
  pending: PendingApproval[];
  onDecide: (id: string, decision: ApprovalVerdict) => void;
}) {
  return (
    <>
      {pending.map((p) => (
        <div className="approval" key={p.id}>
          <div className="approval__label"><span className="approval__dot" /> Approval needed · {p.risk}</div>
          <div className="approval__body">
            The agent wants to run <b>{p.action}</b> — {RISK_COPY[p.risk]} on this page.
          </div>
          <div className="approval__actions">
            <button className="btn btn--allow" onClick={() => onDecide(p.id, 'allow')}>Allow</button>
            <button className="btn btn--deny" onClick={() => onDecide(p.id, 'deny')}>Deny</button>
          </div>
        </div>
      ))}
    </>
  );
}
