import { ModalSheet } from './modal-sheet';

interface HowToProps {
  par: number | null;
  onClose: () => void;
}

export function HowTo({ par, onClose }: HowToProps) {
  return (
    <ModalSheet titleId="howto-title" onDismiss={onClose}>
      <div className="sheet__card howto">
        <h2 className="card__title" id="howto-title" tabIndex={-1}>
          Fold the paper into the shape
        </h2>
        <ol className="howto__steps">
          <li>
            <span className="howto__num num" aria-hidden="true">1</span>
            <div>
              <b>Find the goal.</b> The light outline on the mat is today&rsquo;s target. Fold
              the paper strip until it covers that shape exactly.
            </div>
          </li>
          <li>
            <span className="howto__num num" aria-hidden="true">2</span>
            <div>
              <b>Fold a panel.</b> Drag any paper panel to bend it at a hinge, or pick a hinge
              number at the bottom and tap <b>Fold up</b> or <b>Fold down</b>. Each hinge is
              down, flat or up.
            </div>
          </li>
          <li>
            <span className="howto__num num" aria-hidden="true">3</span>
            <div>
              <b>Use as few folds as you can.</b>{' '}
              {par === null ? 'Par' : <>Par (<span className="num">{par}</span>)</>} is the fewest
              folds possible. Undo is allowed but counts as a fold. Your first solve today is your
              score; after that it&rsquo;s free practice.
            </div>
          </li>
        </ol>
        <div className="card__actions">
          <button className="btn btn--primary" onClick={onClose}>
            Start folding
          </button>
        </div>
        <p className="card__muted howto__keys">
          Keys: 1 to 7 pick a hinge, arrows fold, Z undo, V flip view, ? this help.
        </p>
      </div>
    </ModalSheet>
  );
}
