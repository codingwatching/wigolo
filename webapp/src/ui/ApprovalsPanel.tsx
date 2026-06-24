import { useApprovalsSnapshot, type ApprovalsModel } from '../transport/approvals.js';
import { encodeUp, up } from '../transport/codec.js';
import { SafeText } from './SafeText.js';

/**
 * The approval card panel (7d S1). When the host holds a risky agent action it sends {t:'approval_request',
 * id, action, risk, target?} over the session WS; this panel renders each pending request as a card and emits
 * the human's verdict {t:'approval', id, decision} back THROUGH THE CODEC.
 *
 * Fail-closed at the GUI layer: the server trusts the decision field and the WS is the human channel, so
 * client correctness is the safety property. ONLY the explicit approve control emits decision 'approve'; the
 * deny control emits 'deny'; an un-actioned card emits nothing. Every verdict carries the request's EXACT id
 * (closed over per card), so a click can never settle a sibling request. risk/action are host-authoritative
 * and shown verbatim (no client re-derivation); target.url/ref render through SafeText as inert text. Copy is
 * capability language only.
 */
export interface ApprovalsPanelProps {
  model: ApprovalsModel;
  emit: (wire: string) => void;
}

export function ApprovalsPanel({ model, emit }: ApprovalsPanelProps) {
  const pending = useApprovalsSnapshot(model);
  if (pending.length === 0) return null;
  const decide = (id: number, decision: 'approve' | 'deny') => {
    emit(encodeUp(up.approval(id, decision)));
    model.resolve(id);
  };
  return (
    <section class="studio-approvals" aria-label="Action approvals">
      <h2>Approvals</h2>
      <ul class="studio-approvals-list">
        {pending.map((r) => (
          <li key={r.id} class="studio-approval" data-risk={r.risk}>
            <p class="studio-approval-prompt">
              The agent wants to run a <span class="studio-approval-risk">{r.risk}</span> action:{' '}
              <span class="studio-approval-action">{r.action}</span>
            </p>
            {r.target?.url ? <SafeText class="studio-approval-target" value={r.target.url} /> : null}
            {r.target?.ref ? <SafeText class="studio-approval-target" value={r.target.ref} /> : null}
            <div class="studio-approval-actions">
              <button type="button" class="studio-approval-approve" onClick={() => decide(r.id, 'approve')}>
                Approve
              </button>
              <button type="button" class="studio-approval-deny" onClick={() => decide(r.id, 'deny')}>
                Deny
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
