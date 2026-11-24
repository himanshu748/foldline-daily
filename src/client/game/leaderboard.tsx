import { useEffect, useState } from 'react';
import type { LeaderboardResponse, LeaderboardRow } from '../../shared/api';
import { formatTime } from '../../shared/score';
import { api } from '../lib/api';

function Row({ row }: { row: LeaderboardRow }) {
  return (
    <li className={row.me ? 'board__row board__row--me' : 'board__row'}>
      <span className="board__rank num">{row.rank}</span>
      {row.avatar ? (
        <img className="board__avatar" src={row.avatar} alt="" loading="lazy" />
      ) : (
        <span className="board__avatar board__avatar--none" aria-hidden="true" />
      )}
      <span className="board__name">{row.me ? `${row.name} (you)` : row.name}</span>
      <span className="board__score num">
        {row.folds}, {formatTime(row.ms)}
      </span>
    </li>
  );
}

export function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .leaderboard()
      .then((response) => alive && setData(response))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  if (failed) return null;
  return (
    <section className="board" aria-label="Today's leaderboard">
      <h3 className="board__title">Today&rsquo;s leaders</h3>
      {!data && <p className="board__empty">Loading the field…</p>}
      {data && data.total === 0 && <p className="board__empty">Be the first today.</p>}
      {data && data.total > 0 && (
        <ol className="board__list">
          {data.rows.map((row) => (
            <Row key={row.rank} row={row} />
          ))}
          {data.me && <Row key="me" row={data.me} />}
        </ol>
      )}
    </section>
  );
}
