import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Controller } from './controller';
import { EndCard } from './endcard';

vi.mock('@devvit/web/client', () => ({ context: {} }));
vi.mock('./solve-replay', () => ({ SolveReplay: () => null }));

it('offers another practice round when there is no ranked result to show', () => {
  const controller = new Controller();
  controller.practiceFolds = 3;
  controller.phase = 'solved';

  const card = renderToStaticMarkup(createElement(EndCard, { controller }));

  expect(card).toContain('3 folds');
  expect(card).toContain('Practice again');
  expect(card).not.toContain('Comment your result');
});
