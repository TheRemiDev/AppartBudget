import Avatar from "./Avatar.jsx";
import Icon from "./Icon.jsx";
import { formatAmount } from "../utils/format.js";

// Une ligne "qui paie quoi" d'une depense : la part d'une personne, son
// etat (payee / partiellement / a payer) et l'action utile a cet instant.
export default function ShareStatus({ share, currentUserId, onQuickPay, onOpen }) {
  const paidAmount = share.payments.reduce((sum, p) => sum + p.amount, 0);
  const partial = !share.paid && paidAmount > 0.005;
  const isMine = share.userId === currentUserId;
  const isZero = share.amount <= 0.005;
  const firstName = share.user.name.split(" ")[0];

  let status;
  if (isZero) {
    status = <span className="share-status share-status--none">Rien à payer</span>;
  } else if (share.paid) {
    status = (
      <button type="button" className="share-status share-status--paid" onClick={onOpen} title="Voir ou corriger les paiements">
        <Icon name="checkCircle" size={13} /> Payé
      </button>
    );
  } else if (partial) {
    status = (
      <button type="button" className="share-status share-status--partial" onClick={onOpen} title="Voir ou compléter les paiements">
        {formatAmount(paidAmount)} payés
      </button>
    );
  } else {
    status = <span className="share-status share-status--pending">À payer</span>;
  }

  return (
    <div className="share-row">
      <Avatar user={share.user} size="sm" />
      <span className="share-row__amount">{formatAmount(share.amount)}</span>
      {status}
      {!isZero && !share.paid && (
        <span className="share-row__actions">
          {isMine ? (
            <>
              <button type="button" className="btn btn--primary btn--xs" onClick={onQuickPay}>
                J'ai payé
              </button>
              <button type="button" className="icon-btn icon-btn--xs" title="Payer une partie, à une autre date…" onClick={onOpen}>
                <Icon name="dots" size={14} />
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--ghost btn--xs" onClick={onOpen} title={`Payer la part de ${share.user.name} à sa place`}>
              Payer pour {firstName}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
